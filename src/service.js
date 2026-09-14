import { Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { SessionKeyRouter, TenantError, TenantPolicy } from './policy.js'
import { WorkOSAuthService, resolveWorkOSConfig } from './auth.js'
import { createTenantStorage, resolveTenantStorageConfig } from './storage.js'
import { ManagedTenantConfigStore, mergeTenantConfig } from './config.js'
import {
  filterMemberNamespace,
  filterMemberProviders,
  filterModelCatalog,
  isConfigurationAdmin,
  mapRpcValue,
  rewriteMemberModelOps,
  rpcForbidden,
  tenantCredentialRef,
} from './model-scope.js'

export class TenantPolicyService extends Service {
  static Config = Schema.object({
    adminRoles: Schema.array(Schema.string()).default(['owner', 'admin']),
    adminCanManageKeys: Schema.boolean().default(false),
    network: Schema.object({
      allowNetworkAccess: Schema.boolean().default(false),
    }).default({}),
    workos: Schema.any().hidden(),
    storage: Schema.object({
      mode: Schema.union([Schema.const('local'), Schema.const('d1')]).default('local'),
      filePath: Schema.string().description('Local tenant state JSON path'),
      encryptionKey: Schema.string().role('secret').hidden(),
      d1: Schema.any().hidden(),
    }).collapse(true),
  })

  constructor(ctx, config = {}) {
    super(ctx, 'tenantPolicy')
    this.config = config
    this.storage = createTenantStorage(config.storage, { preferConfig: true })
    this.policy = new TenantPolicy({
      ...config,
      onChange: state => this.persistState(state),
    })
    this.keyRouter = new SessionKeyRouter(this.policy)
  }

  async [Service.init]() {
    this.policy.hydrate(await this.storage.load())
    this.auth = this.ctx.get('workosAuth', false)
    if (this.auth) this.installRuntimeGuards()
  }

  updateAccessPolicy(config) {
    this.config = { ...this.config, ...config }
    this.policy.configure(config)
  }

  async persistState(state) {
    try {
      await this.storage.save(state)
      this.storageError = undefined
    } catch (error) {
      this.storageError = error
      this.ctx.logger?.error?.(`tenant storage write failed: ${error.message}`)
      throw error
    }
  }

  claimSession(identity, sessionId) {
    return this.policy.claimSession(identity, sessionId)
  }

  assertSessionAccess(identity, sessionId) {
    return this.policy.assertSessionAccess(identity, sessionId)
  }

  claimWorkspace(identity, workspaceId) {
    return this.policy.claimWorkspace(identity, workspaceId)
  }

  assertWorkspaceAccess(identity, workspaceId) {
    return this.policy.assertWorkspaceAccess(identity, workspaceId)
  }

  forgetSession(sessionId) {
    return this.policy.forgetSession(sessionId)
  }

  forgetWorkspace(workspaceId) {
    return this.policy.forgetWorkspace(workspaceId)
  }

  listOwnedSessions(identity) {
    return this.policy.listOwnedSessions(identity)
  }

  listOwnedWorkspaces(identity) {
    return this.policy.listOwnedWorkspaces(identity)
  }

  canAccessSession(identity, sessionId) {
    return this.policy.canAccessSession(identity, sessionId)
  }

  canAccessWorkspace(identity, workspaceId) {
    return this.policy.canAccessWorkspace(identity, workspaceId)
  }

  setApiKey(identity, provider, apiKey, targetUserId) {
    return this.policy.setApiKey(identity, provider, apiKey, targetUserId)
  }

  describeApiKeys(identity) {
    return this.policy.describeApiKeys(identity)
  }

  resolveApiKey(identity, provider, targetUserId) {
    return this.policy.resolveApiKey(identity, provider, targetUserId)
  }

  resolveApiKeyForSession(sessionId, provider) {
    return this.policy.resolveApiKeyForSession(sessionId, provider)
  }

  resolveSessionApiKey(request) {
    return this.keyRouter.resolve(request)
  }

  currentIdentity() {
    const identity = this.auth?.currentIdentity()
    if (!identity) throw new TenantError('AUTH_REQUIRED', 'A WorkOS identity is required', 401)
    return identity
  }

  installRuntimeGuards() {
    this.patchSessionController(this.ctx.get('sessionController', false))
    this.patchWorkspaceController(this.ctx.get('workspaceController', false))
    this.patchApiProxy(this.ctx.get('apiProxy', false))
    this.patchCredentialProvider(this.ctx.get('credentials', false))
    this.patchAdminService(this.ctx.get('pluginInventory', false), ['list'])
    this.ctx.on('internal/service', name => {
      if (name === 'sessionController') this.patchSessionController(this.ctx.get(name, false))
      if (name === 'workspaceController') this.patchWorkspaceController(this.ctx.get(name, false))
      if (name === 'apiProxy') this.patchApiProxy(this.ctx.get(name, false))
      if (name === 'credentials') this.patchCredentialProvider(this.ctx.get(name, false))
      if (name === 'pluginInventory') this.patchAdminService(this.ctx.get(name, false), ['list'])
    })
  }

  patchAdminService(service, methods) {
    const target = service?.[Symbol.for('cordis.original')] ?? service
    const prototype = target && Object.getPrototypeOf(target)
    if (!prototype || prototype === Object.prototype || prototype.__dshTenantAdminGuarded) return
    const originals = new Map()
    for (const name of methods) {
      if (typeof prototype[name] !== 'function') continue
      const original = prototype[name]
      originals.set(name, original)
      const tenant = this
      prototype[name] = function (...args) {
        if (!isConfigurationAdmin(tenant.currentIdentity())) {
          throw new TenantError('ADMIN_REQUIRED', 'Administrator permission is required', 403)
        }
        return original.call(this, ...args)
      }
    }
    if (originals.size === 0) return
    Object.defineProperty(prototype, '__dshTenantAdminGuarded', { value: true, configurable: true })
    this.ctx.effect(() => {
      for (const [name, original] of originals) prototype[name] = original
      delete prototype.__dshTenantAdminGuarded
    }, 'tenant-policy: restore admin service guards')
  }

  patchCredentialProvider(provider) {
    const target = provider?.[Symbol.for('cordis.original')] ?? provider
    const prototype = target && Object.getPrototypeOf(target)
    if (!prototype || prototype === Object.prototype || prototype.__dshTenantCredentials) return
    const originals = Object.fromEntries(['resolve', 'describe', 'set', 'unset']
      .filter(name => typeof prototype[name] === 'function')
      .map(name => [name, prototype[name]]))
    if (Object.keys(originals).length !== 4) return
    const service = this
    prototype.resolve = async function (ref, ...args) {
      const identity = service.auth.currentIdentity()
      if (!identity) return originals.resolve.call(this, ref, ...args)
      const scoped = await originals.resolve.call(this, tenantCredentialRef(identity, String(ref)), ...args)
      return scoped ?? originals.resolve.call(this, ref, ...args)
    }
    prototype.describe = async function (ref, ...args) {
      const identity = service.auth.currentIdentity()
      if (!identity) return originals.describe.call(this, ref, ...args)
      const scopedRef = tenantCredentialRef(identity, String(ref))
      const scoped = await originals.describe.call(this, scopedRef, ...args)
      if (scoped.configured) return { ...scoped, source: 'user' }
      const shared = await originals.describe.call(this, ref, ...args)
      return shared.configured ? { ...shared, writable: scoped.writable } : scoped
    }
    prototype.set = function (ref, value, ...args) {
      const identity = service.auth.currentIdentity()
      const targetRef = identity ? tenantCredentialRef(identity, String(ref)) : ref
      return originals.set.call(this, targetRef, value, ...args)
    }
    prototype.unset = function (ref, ...args) {
      const identity = service.auth.currentIdentity()
      const targetRef = identity ? tenantCredentialRef(identity, String(ref)) : ref
      return originals.unset.call(this, targetRef, ...args)
    }
    Object.defineProperty(prototype, '__dshTenantCredentials', { value: true, configurable: true })
    this.ctx.effect(() => {
      for (const [name, original] of Object.entries(originals)) prototype[name] = original
      delete prototype.__dshTenantCredentials
    }, 'tenant-policy: restore credential scoping')
  }

  patchApiProxy(proxy) {
    const target = proxy?.[Symbol.for('cordis.original')] ?? proxy
    if (!target || target.__dshTenantApiGuarded) return
    const settings = target.settings
    const llm = target.llm
    const sessions = target.sessions
    const agentPresets = target.agentPresets
    if (!settings || !llm || !sessions) return
    const originals = {
      settings: Object.fromEntries(['describe', 'openDocument', 'update', 'replace', 'mutate']
        .filter(name => typeof settings[name] === 'function').map(name => [name, settings[name]])),
      llm: Object.fromEntries(['providers', 'models']
        .filter(name => typeof llm[name] === 'function').map(name => [name, llm[name]])),
      sessions: typeof sessions.models === 'function' ? { models: sessions.models } : {},
      agentPresets: Object.fromEntries(['copy', 'openDocument', 'remove']
        .filter(name => typeof agentPresets?.[name] === 'function').map(name => [name, agentPresets[name]])),
    }
    const service = this
    const identity = () => service.currentIdentity()
    const directory = () => service.ctx.llm.listConfigurableProviders()
    const modelNamespaces = () => new Set(directory().map(entry => entry.settingsNs))

    settings.describe = async function (request, ...args) {
      const current = identity()
      const response = await originals.settings.describe.call(this, request, ...args)
      if (isConfigurationAdmin(current)) return response
      const entries = directory()
      const allowed = modelNamespaces()
      return mapRpcValue(response, value => ({
        ...value,
        hasDocument: false,
        namespaces: (value.namespaces ?? [])
          .filter(namespace => allowed.has(namespace.ns))
          .map(namespace => filterMemberNamespace(current, entries, namespace)),
      }))
    }
    for (const name of ['openDocument', 'update', 'replace']) {
      if (!originals.settings[name]) continue
      settings[name] = function (request, ...args) {
        const current = identity()
        if (!isConfigurationAdmin(current)) return Promise.resolve(rpcForbidden(request))
        return originals.settings[name].call(this, request, ...args)
      }
    }
    settings.mutate = async function (request, ...args) {
      const current = identity()
      if (isConfigurationAdmin(current)) return originals.settings.mutate.call(this, request, ...args)
      if (!modelNamespaces().has(request.payload.ns)) return rpcForbidden(request)
      let ops
      try {
        ops = rewriteMemberModelOps(current, directory(), request.payload.ns, request.payload.ops)
      } catch (error) {
        return rpcForbidden(request, error.message)
      }
      const response = await originals.settings.mutate.call(this, {
        ...request,
        payload: { ...request.payload, ops },
      }, ...args)
      return mapRpcValue(response, descriptor => filterMemberNamespace(current, directory(), descriptor))
    }
    if (originals.llm.providers) llm.providers = async function (request, ...args) {
      const current = identity()
      const response = await originals.llm.providers.call(this, request, ...args)
      if (isConfigurationAdmin(current)) return response
      return mapRpcValue(response, value => ({
        ...value,
        providers: filterMemberProviders(current, value.providers ?? []),
      }))
    }
    if (originals.llm.models) llm.models = async function (request, ...args) {
      const current = identity()
      const response = await originals.llm.models.call(this, request, ...args)
      return isConfigurationAdmin(current)
        ? response
        : mapRpcValue(response, value => filterModelCatalog(current, value))
    }
    if (originals.sessions.models) sessions.models = async function (request, ...args) {
      const current = identity()
      const response = await originals.sessions.models.call(this, request, ...args)
      return isConfigurationAdmin(current)
        ? response
        : mapRpcValue(response, value => filterModelCatalog(current, value))
    }
    for (const [name, original] of Object.entries(originals.agentPresets)) {
      agentPresets[name] = function (request, ...args) {
        const current = identity()
        if (!isConfigurationAdmin(current)) return Promise.resolve(rpcForbidden(request))
        return original.call(this, request, ...args)
      }
    }

    Object.defineProperty(target, '__dshTenantApiGuarded', { value: true, configurable: true })
    this.ctx.effect(() => {
      Object.assign(settings, originals.settings)
      Object.assign(llm, originals.llm)
      Object.assign(sessions, originals.sessions)
      if (agentPresets) Object.assign(agentPresets, originals.agentPresets)
      delete target.__dshTenantApiGuarded
    }, 'tenant-policy: restore API configuration guards')
  }

  patchPrototype(controller, methods) {
    const target = controller?.[Symbol.for('cordis.original')] ?? controller
    const prototype = target && Object.getPrototypeOf(target)
    if (!prototype || prototype === Object.prototype || prototype.__dshTenantGuarded) return
    const originals = new Map()
    for (const [name, wrapper] of Object.entries(methods)) {
      if (typeof prototype[name] !== 'function') continue
      originals.set(name, prototype[name])
      prototype[name] = wrapper(prototype[name])
    }
    if (originals.size === 0) return
    Object.defineProperty(prototype, '__dshTenantGuarded', { value: true, configurable: true })
    this.ctx.effect(() => {
      for (const [name, original] of originals) prototype[name] = original
      delete prototype.__dshTenantGuarded
    }, `tenant-policy: restore ${target.name ?? 'controller'} guards`)
  }

  patchSessionController(controller) {
    if (!controller || !this.auth) return
    const guard = this.sessionGuard ??= new (class {
      constructor(policy) { this.policy = policy }
      authorize(identity, request) { return this.policy.assertSessionAccess(identity, request?.sessionId) }
      authorizeAddress(identity, request) {
        const address = request?.address
        const ids = address?.kind === 'subagent'
          ? [address.parentSessionId, address.childSessionId]
          : [address?.sessionId]
        if (!ids[0]) throw new TenantError('SESSION_NOT_REGISTERED', 'A session address is required', 400)
        return ids.map(id => this.policy.assertSessionAccess(identity, id))
      }
      filter(identity, value) {
        return { ...value, items: (value?.items ?? []).filter(item => this.policy.canAccessSession(identity, item.sessionId)) }
      }
      claim(identity, request, value) {
        if (request?.workspaceId) this.policy.assertWorkspaceAccess(identity, request.workspaceId)
        this.policy.claimSession(identity, value?.sessionId)
        return value
      }
    })(this.policy)
    const service = this
    const requireIdentity = () => service.currentIdentity()
    const sessionRequest = original => function (request, ...args) {
      guard.authorize(requireIdentity(), request)
      return original.call(this, request, ...args)
    }
    this.patchPrototype(controller, {
      list: original => function (request, ...args) {
        const result = original.call(this, request, ...args)
        return Promise.resolve(result).then(value => guard.filter(requireIdentity(), value))
      },
      search: original => function (request, ...args) {
        const result = original.call(this, request, ...args)
        return Promise.resolve(result).then(value => guard.filter(requireIdentity(), value))
      },
      create: original => function (request, ...args) {
        const identity = requireIdentity()
        if (request?.workspaceId) service.assertWorkspaceAccess(identity, request.workspaceId)
        return Promise.resolve(original.call(this, request, ...args)).then(value => guard.claim(identity, request, value))
      },
      selectModel: sessionRequest,
      rename: sessionRequest,
      fork: original => function (request, ...args) {
        const identity = requireIdentity()
        guard.authorize(identity, request)
        return Promise.resolve(original.call(this, request, ...args)).then(value => {
          service.claimSession(identity, value?.sessionId)
          return value
        })
      },
      prompt: sessionRequest,
      attachment: sessionRequest,
      updateQueue: sessionRequest,
      cancel: sessionRequest,
      page: original => function (request, ...args) {
        guard.authorizeAddress(requireIdentity(), request)
        return original.call(this, request, ...args)
      },
      follow: original => function (request, ...args) {
        guard.authorizeAddress(requireIdentity(), request)
        return original.call(this, request, ...args)
      },
      control: original => function (...args) {
        requireIdentity()
        const stream = original.call(this, ...args)
        return (async function* () {
          for await (const frame of stream) {
            const identity = requireIdentity()
            if (frame?.type === 'baseline') {
              const allowed = key => service.canAccessSession(identity, key)
              const filterMap = value => Object.fromEntries(
                Object.entries(value ?? {}).filter(([key]) => allowed(key)),
              )
              yield { ...frame, value: {
                ...frame.value,
                queues: filterMap(frame.value?.queues),
                jobs: filterMap(frame.value?.jobs),
                projections: filterMap(frame.value?.projections),
              } }
            } else if (frame?.sessionId === undefined || service.canAccessSession(identity, frame.sessionId)) {
              yield frame
            }
          }
        })()
      },
    })
  }

  patchWorkspaceController(controller) {
    if (!controller || !this.auth) return
    const service = this
    const requireIdentity = () => service.currentIdentity()
    const workspaceIdRequest = original => function (request, ...args) {
      service.assertWorkspaceAccess(requireIdentity(), request?.workspaceId)
      return original.call(this, request, ...args)
    }
    this.patchPrototype(controller, {
      create: original => function (request, ...args) {
        const identity = requireIdentity()
        return Promise.resolve(original.call(this, request, ...args)).then(value => {
          service.claimWorkspace(identity, value?.workspace?.workspaceId)
          return value
        })
      },
      rename: workspaceIdRequest,
      delete: workspaceIdRequest,
      insertBefore: workspaceIdRequest,
      insertSessionBefore: original => function (request, ...args) {
        const identity = requireIdentity()
        service.assertWorkspaceAccess(identity, request?.workspaceId)
        service.assertSessionAccess(identity, request?.sessionId)
        return original.call(this, request, ...args)
      },
      archiveSession: original => function (request, ...args) {
        const identity = requireIdentity()
        service.assertSessionAccess(identity, request?.sessionId)
        return original.call(this, request, ...args)
      },
      follow: original => function (...args) {
        requireIdentity()
        const stream = original.call(this, ...args)
        return (async function* () {
          for await (const frame of stream) {
            if (frame?.type === 'baseline') {
              const identity = requireIdentity()
              const value = frame.value
              yield { ...frame, value: {
                ...value,
                items: (value.items ?? []).filter(item => service.canAccessWorkspace(identity, item.workspaceId)),
                archivedSessionIds: (value.archivedSessionIds ?? []).filter(id => service.canAccessSession(identity, id)),
              } }
            } else if (frame?.type === 'upsert') {
              if (service.canAccessWorkspace(requireIdentity(), frame.workspace?.workspaceId)) yield frame
            } else if (frame?.type === 'remove') {
              if (service.canAccessWorkspace(requireIdentity(), frame.workspaceId)) yield frame
            } else if (frame?.type === 'order') {
              const identity = requireIdentity()
              yield { ...frame, workspaceIds: frame.workspaceIds.filter(id => service.canAccessWorkspace(identity, id)) }
            } else if (frame?.type === 'archived') {
              const identity = requireIdentity()
              yield { ...frame, archivedSessionIds: frame.archivedSessionIds.filter(id => service.canAccessSession(identity, id)) }
            }
          }
        })()
      },
    })
  }
}

export const name = 'dsh-workos-tenant'
export const inject = []

export async function apply(ctx, config = {}) {
  const managedStore = new ManagedTenantConfigStore(config.management)
  const managed = managedStore.load()
  const merged = mergeTenantConfig(config, managed)
  const preferManaged = Object.keys(managed).length > 0
  const authConfig = resolveWorkOSConfig(merged.workos, { preferConfig: preferManaged })
  const storageConfig = resolveTenantStorageConfig(merged.storage, { preferConfig: preferManaged })
  const effectiveConfig = { ...merged, workos: authConfig, storage: storageConfig }
  if (authConfig.enabled) await ctx.plugin(WorkOSAuthService, {
    ...authConfig,
    management: {
      store: managedStore,
      effectiveConfig,
    },
  })

  await ctx.plugin(TenantPolicyService, effectiveConfig)
  const service = ctx.get('tenantPolicy')
  ctx.on('session/disposed', session => service.forgetSession(session.id))
}

export default apply
