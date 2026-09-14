import { Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { resolve } from 'node:path'
import { SessionKeyRouter, TenantError, TenantPolicy } from './policy.js'
import { WorkOSAuthService, resolveWorkOSConfig } from './auth.js'
import { createTenantStorage, resolveTenantStorageConfig } from './storage.js'
import { ManagedTenantConfigStore, mergeTenantConfig } from './config.js'
import { assertWorkspacePath, userWorkspaceRoot } from './workspace-scope.js'
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
  static inject = ['sessionController', 'workspaceController']

  static Config = Schema.object({
    adminRoles: Schema.array(Schema.string()).default(['owner', 'admin']),
    adminCanManageKeys: Schema.boolean().default(false),
    network: Schema.object({
      allowNetworkAccess: Schema.boolean().default(false),
    }).default({}),
    workspace: Schema.object({
      root: Schema.string().default('').description('Base directory for organization/user Workspace roots'),
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
    this.ctx.inject(['workosAuth'], ctx => {
      this.auth = ctx.workosAuth
      this.installRuntimeGuards()
    })
  }

  updateAccessPolicy(config) {
    this.config = { ...this.config, ...config }
    this.policy.configure(config)
    if (this.config?.workspace?.root) this.patchDirectoryPicker(this.ctx.get('directoryPickerController', false))
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

  userWorkspaceRoot(identity, ensure = false) {
    return userWorkspaceRoot(this.config, identity, ensure)
  }

  assertWorkspacePath(identity, path, options) {
    if (!this.config?.workspace?.root) return path
    if (typeof path !== 'string' || !path) throw new TenantError('WORKSPACE_PATH_REQUIRED', 'A Workspace path is required', 400)
    return assertWorkspacePath(this.config, identity, path, options)
  }

  assertWorkspaceLocation(identity, workspaceId) {
    this.assertWorkspaceAccess(identity, workspaceId)
    const registry = this.ctx.get('workspaceRegistry', false)
    const workspace = registry?.get?.(workspaceId)
    if (workspace?.path) this.assertWorkspacePath(identity, workspace.path)
    return workspace
  }

  canAccessWorkspaceLocation(identity, workspaceId, path) {
    try {
      if (!this.canAccessWorkspace(identity, workspaceId)) return false
      if (!this.config?.workspace?.root) return true
      const registry = this.ctx.get('workspaceRegistry', false)
      const workspacePath = path ?? registry?.get?.(workspaceId)?.path
      this.assertWorkspacePath(identity, workspacePath)
      return true
    } catch {
      return false
    }
  }

  assertSessionLocation(identity, sessionId) {
    this.assertSessionAccess(identity, sessionId)
    if (!this.config?.workspace?.root) return
    return (async () => {
      const live = this.ctx.get('sessions', false)?.get(sessionId)?.header
      const stored = live ? undefined : await this.ctx.get('sessionPersistence').stat(sessionId)
      const header = live ?? stored?.header
      if (!header?.cwd) throw new TenantError('WORKSPACE_PATH_REQUIRED', 'Session has no Workspace path', 403)
      this.assertWorkspacePath(identity, header.cwd)
    })()
  }

  async canAccessSessionLocation(identity, sessionId) {
    try { await this.assertSessionLocation(identity, sessionId); return true } catch { return false }
  }

  installRuntimeGuards() {
    if (this.runtimeGuardsInstalled) return
    this.runtimeGuardsInstalled = true
    this.patchSessionController(this.ctx.get('sessionController', false))
    this.patchWorkspaceController(this.ctx.get('workspaceController', false))
    this.patchWorkspaceFiles(this.ctx.get('workspaceFiles', false))
    this.patchDirectoryPicker(this.ctx.get('directoryPickerController', false))
    this.patchGateway(this.ctx.get('typertGateway', false))
    this.patchApiProxy(this.ctx.get('apiProxy', false))
    this.patchCredentialProvider(this.ctx.get('credentials', false))
    this.patchAdminService(this.ctx.get('pluginInventory', false), ['list'])
    this.ctx.on('internal/service', name => {
      if (name === 'sessionController') this.patchSessionController(this.ctx.get(name, false))
      if (name === 'workspaceController') this.patchWorkspaceController(this.ctx.get(name, false))
      if (name === 'workspaceFiles') this.patchWorkspaceFiles(this.ctx.get(name, false))
      if (name === 'directoryPickerController') this.patchDirectoryPicker(this.ctx.get(name, false))
      if (name === 'typertGateway') this.patchGateway(this.ctx.get(name, false))
      if (name === 'apiProxy') this.patchApiProxy(this.ctx.get(name, false))
      if (name === 'credentials') this.patchCredentialProvider(this.ctx.get(name, false))
      if (name === 'pluginInventory') this.patchAdminService(this.ctx.get(name, false), ['list'])
    })
    this.ctx.on('session/created', session => {
      const parent = this.policy.sessions.get(session.header?.parentSession)
      const identity = parent ?? this.auth.currentIdentity()
      if (identity) this.claimSession({ ...identity, role: identity.role ?? 'member' }, session.id)
    })
  }

  async legacyResources(identity, adopt = false) {
    if (!isConfigurationAdmin(identity)) throw new TenantError('ADMIN_REQUIRED', 'Administrator permission is required')
    const stored = await this.ctx.get('sessionPersistence').list()
    const headers = stored.map(row => row.header ?? row)
    const workspaces = this.ctx.get('workspaceRegistry').list()
    const sessions = headers.filter(header => !this.policy.sessions.has(header.id))
    const missingWorkspaces = workspaces.filter(workspace => !this.policy.workspaces.has(workspace.id))
    if (adopt) {
      const next = this.policy.snapshot()
      const record = {
        organizationId: identity.organizationId, userId: identity.userId,
        owner: `${identity.organizationId}:${identity.userId}`, createdAt: new Date().toISOString(),
      }
      next.sessions.push(...sessions.map(header => ({ id: header.id, ...record })))
      next.workspaces.push(...missingWorkspaces.map(workspace => ({ id: workspace.id, ...record })))
      this.policy.hydrate(next)
      await this.persistState(next)
    }
    return { sessions: sessions.length, workspaces: missingWorkspaces.length }
  }

  patchGateway(gateway) {
    const target = gateway?.[Symbol.for('cordis.original')] ?? gateway
    const prototype = target && Object.getPrototypeOf(target)
    if (!prototype || prototype.__dshTenantEventsGuarded || typeof prototype.openRemoteEvents !== 'function') return
    const original = prototype.openRemoteEvents
    const tenant = this
    prototype.openRemoteEvents = function (payload, signal) {
      const identity = tenant.currentIdentity()
      const stream = original.call(this, payload, signal)
      return (async function* () {
        for await (const frame of stream) {
          if (frame.type === 'waterfall') {
            if (tenant.config?.workspace?.root
              ? await tenant.canAccessSessionLocation(identity, frame.agentId)
              : tenant.canAccessSession(identity, frame.agentId)) yield frame
          } else if (frame.type === 'emit' && frame.event.startsWith('api-session/')) {
            const id = frame.event === 'api-session/added' ? frame.args?.[0]?.sessionId : frame.args?.[0]
            if (tenant.config?.workspace?.root
              ? await tenant.canAccessSessionLocation(identity, id)
              : tenant.canAccessSession(identity, id)) yield frame
          } else {
            yield frame
          }
        }
      })()
    }
    Object.defineProperty(prototype, '__dshTenantEventsGuarded', { value: true, configurable: true })
    this.ctx.effect(() => () => {
      prototype.openRemoteEvents = original
      delete prototype.__dshTenantEventsGuarded
    }, 'tenant-policy: restore event stream guards')
  }

  patchWorkspaceFiles(files) {
    const tenant = this
    const wrappers = Object.fromEntries(['list', 'read', 'readAll', 'readBytes', 'readRelated', 'stat', 'changes'].map(name => [name,
      original => function (scope, ...args) {
        const identity = tenant.currentIdentity()
        tenant.assertSessionAccess(identity, scope?.sessionId)
        tenant.assertWorkspacePath(identity, scope?.workspaceRoot)
        if (typeof args[0] === 'string') tenant.assertWorkspacePath(identity, args[0], { relativeTo: scope.workspaceRoot })
        return original.call(this, scope, ...args)
      },
    ]))
    this.patchPrototype(files, wrappers)
  }

  patchDirectoryPicker(controller) {
    if (!this.config?.workspace?.root) return
    const tenant = this
    this.patchPrototype(controller, {
      list: original => function (path, ...args) {
        if (!tenant.config?.workspace?.root) return original.call(this, path, ...args)
        const identity = tenant.currentIdentity()
        const root = tenant.userWorkspaceRoot(identity, true)
        const target = path === undefined
          ? root
          : tenant.assertWorkspacePath(identity, path, { ensureRoot: true })
        return Promise.resolve(original.call(this, target, ...args)).then(value => {
          const allowed = row => {
            try { tenant.assertWorkspacePath(identity, row.path); return true } catch { return false }
          }
          return { ...value, home: root, crumbs: value.crumbs.filter(allowed), entries: value.entries.filter(allowed) }
        })
      },
      createDirectory: original => function (path, name, ...args) {
        if (!tenant.config?.workspace?.root) return original.call(this, path, name, ...args)
        const identity = tenant.currentIdentity()
        const parent = tenant.assertWorkspacePath(identity, path, { ensureRoot: true })
        tenant.assertWorkspacePath(identity, resolve(parent, name))
        return original.call(this, parent, name, ...args)
      },
      pick: original => async function (...args) {
        if (!tenant.config?.workspace?.root) return original.call(this, ...args)
        const identity = tenant.currentIdentity()
        const path = await original.call(this, ...args)
        return path === null ? null : tenant.assertWorkspacePath(identity, path, { ensureRoot: true })
      },
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
    this.ctx.effect(() => () => {
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
    this.ctx.effect(() => () => {
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
    this.ctx.effect(() => () => {
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
    this.ctx.effect(() => () => {
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
        for (const id of ids) this.policy.assertSessionAccess(identity, id)
        return ids
      }
      filter(identity, value) {
        return { ...value, items: (value?.items ?? []).filter(item => {
          if (!this.policy.canAccessSession(identity, item.sessionId)) return false
          try { service.assertWorkspacePath(identity, item.cwd); return true } catch { return false }
        }) }
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
      const current = requireIdentity()
      if (!service.config?.workspace?.root) {
        guard.authorize(current, request)
        return original.call(this, request, ...args)
      }
      const controller = this
      return Promise.resolve(service.assertSessionLocation(current, request?.sessionId)).then(() =>
        original.call(controller, request, ...args))
    }
    this.patchPrototype(controller, {
      list: original => function (request, ...args) {
        const current = requireIdentity()
        const result = original.call(this, request, ...args)
        return Promise.resolve(result).then(value => guard.filter(current, value))
      },
      search: original => function (request, ...args) {
        const current = requireIdentity()
        const result = original.call(this, request, ...args)
        return Promise.resolve(result).then(value => guard.filter(current, value))
      },
      create: original => function (request, ...args) {
        const identity = requireIdentity()
        if (request?.workspaceId) service.assertWorkspaceLocation(identity, request.workspaceId)
        const normalizedCwd = request?.cwd
          ? service.assertWorkspacePath(identity, request.cwd, { ensureRoot: true })
          : request?.workspaceId ? undefined : service.userWorkspaceRoot(identity, true)
        const controller = this
        return (async () => {
          if (request?.sessionId) {
            const stored = await service.ctx.get('sessionPersistence').list()
            if (stored.some(row => (row.header ?? row).id === request.sessionId)) {
              await service.assertSessionLocation(identity, request.sessionId)
            }
          }
          const normalized = normalizedCwd === undefined ? request : { ...request, cwd: normalizedCwd }
          return guard.claim(identity, normalized, await original.call(controller, normalized, ...args))
        })()
      },
      selectModel: sessionRequest,
      rename: sessionRequest,
      fork: original => function (request, ...args) {
        const identity = requireIdentity()
        if (!service.config?.workspace?.root) guard.authorize(identity, request)
        const controller = this
        return Promise.resolve(service.assertSessionLocation(identity, request?.sessionId)).then(() =>
          original.call(controller, request, ...args)).then(value => {
            service.claimSession(identity, value?.sessionId)
            return value
          })
      },
      prompt: sessionRequest,
      attachment: sessionRequest,
      updateQueue: sessionRequest,
      cancel: sessionRequest,
      page: original => async function (request, ...args) {
        const identity = requireIdentity()
        const ids = guard.authorizeAddress(identity, request)
        if (service.config?.workspace?.root) for (const id of ids) await service.assertSessionLocation(identity, id)
        return original.call(this, request, ...args)
      },
      follow: original => function (request, ...args) {
        const current = requireIdentity()
        const records = guard.authorizeAddress(current, request)
        const controller = this
        return (async function* () {
          for (const id of records) await service.assertSessionLocation(current, id)
          yield* original.call(controller, request, ...args)
        })()
      },
      control: original => function (...args) {
        const current = requireIdentity()
        const stream = original.call(this, ...args)
        return (async function* () {
          for await (const frame of stream) {
            if (frame?.type === 'baseline') {
              const allowed = new Set()
              for (const key of new Set(Object.keys(frame.value?.queues ?? {}).concat(
                Object.keys(frame.value?.jobs ?? {}), Object.keys(frame.value?.projections ?? {})))) {
                if (service.config?.workspace?.root
                  ? await service.canAccessSessionLocation(current, key)
                  : service.canAccessSession(current, key)) allowed.add(key)
              }
              const filterMap = value => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => allowed.has(key)))
              yield { ...frame, value: {
                ...frame.value,
                queues: filterMap(frame.value?.queues),
                jobs: filterMap(frame.value?.jobs),
                projections: filterMap(frame.value?.projections),
              } }
            } else if (frame?.sessionId === undefined || (service.config?.workspace?.root
              ? await service.canAccessSessionLocation(current, frame.sessionId)
              : service.canAccessSession(current, frame.sessionId))) {
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
      service.assertWorkspaceLocation(requireIdentity(), request?.workspaceId)
      return original.call(this, request, ...args)
    }
    this.patchPrototype(controller, {
      create: original => function (request, ...args) {
        const identity = requireIdentity()
        const path = service.assertWorkspacePath(identity, request?.path, { ensureRoot: true })
        return Promise.resolve(original.call(this, { ...request, path }, ...args)).then(value => {
          if (value?.created === false) service.assertWorkspaceAccess(identity, value?.workspace?.workspaceId)
          service.claimWorkspace(identity, value?.workspace?.workspaceId)
          return value
        })
      },
      rename: workspaceIdRequest,
      delete: workspaceIdRequest,
      insertBefore: workspaceIdRequest,
      insertSessionBefore: original => function (request, ...args) {
        const identity = requireIdentity()
        service.assertWorkspaceLocation(identity, request?.workspaceId)
        return Promise.resolve(service.assertSessionLocation(identity, request?.sessionId)).then(() =>
          original.call(this, request, ...args))
      },
      archiveSession: original => function (request, ...args) {
        const identity = requireIdentity()
        return Promise.resolve(service.assertSessionLocation(identity, request?.sessionId)).then(() =>
          original.call(this, request, ...args))
      },
      follow: original => function (...args) {
        const current = requireIdentity()
        const stream = original.call(this, ...args)
        return (async function* () {
          for await (const frame of stream) {
            if (frame?.type === 'baseline') {
              const value = frame.value
              const items = []
              for (const item of value.items ?? []) {
                if (!service.canAccessWorkspaceLocation(current, item.workspaceId, item.path)) continue
                const sessionIds = []
                for (const id of item.sessionIds ?? []) {
                  if (service.config?.workspace?.root
                    ? await service.canAccessSessionLocation(current, id)
                    : service.canAccessSession(current, id)) sessionIds.push(id)
                }
                items.push({ ...item, sessionIds })
              }
              const archivedSessionIds = []
              for (const id of value.archivedSessionIds ?? []) {
                if (service.config?.workspace?.root
                  ? await service.canAccessSessionLocation(current, id)
                  : service.canAccessSession(current, id)) archivedSessionIds.push(id)
              }
              yield { ...frame, value: {
                ...value,
                items,
                archivedSessionIds,
              } }
            } else if (frame?.type === 'upsert') {
              if (!service.canAccessWorkspaceLocation(current, frame.workspace?.workspaceId, frame.workspace?.path)) continue
              const sessionIds = []
              for (const id of frame.workspace.sessionIds ?? []) {
                if (service.config?.workspace?.root
                  ? await service.canAccessSessionLocation(current, id)
                  : service.canAccessSession(current, id)) sessionIds.push(id)
              }
              yield { ...frame, workspace: { ...frame.workspace, sessionIds } }
            } else if (frame?.type === 'remove') {
              if (service.canAccessWorkspace(current, frame.workspaceId)) yield frame
            } else if (frame?.type === 'order') {
              yield { ...frame, workspaceIds: frame.workspaceIds.filter(id => service.canAccessWorkspaceLocation(current, id)) }
            } else if (frame?.type === 'archived') {
              const archivedSessionIds = []
              for (const id of frame.archivedSessionIds) {
                if (service.config?.workspace?.root
                  ? await service.canAccessSessionLocation(current, id)
                  : service.canAccessSession(current, id)) archivedSessionIds.push(id)
              }
              yield { ...frame, archivedSessionIds }
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
  }).await()

  await ctx.plugin(TenantPolicyService, effectiveConfig).await()
  // Harness disposal detaches a live session; its durable owner must survive.
}

export default apply
