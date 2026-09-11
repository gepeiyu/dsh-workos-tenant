import { Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { SessionKeyRouter, TenantError, TenantPolicy } from './policy.js'
import { WorkOSAuthService, resolveWorkOSConfig } from './auth.js'
import { createTenantStorage } from './storage.js'

export class TenantPolicyService extends Service {
  static Config = Schema.object({
    adminRoles: Schema.array(Schema.string()).default(['owner', 'admin']),
    adminCanManageKeys: Schema.boolean().default(false),
    workos: Schema.any().hidden(),
    storage: Schema.object({
      mode: Schema.union([Schema.const('local'), Schema.const('d1')]).default('local'),
      filePath: Schema.string().description('Local tenant state JSON path'),
      d1: Schema.object({
        apiBaseUrl: Schema.string(),
      }).collapse(true),
    }).collapse(true),
  })

  constructor(ctx, config = {}) {
    super(ctx, 'tenantPolicy')
    this.config = config
    this.storage = createTenantStorage(config.storage)
    this.policy = new TenantPolicy({
      ...config,
      onChange: state => this.persistState(state),
    })
    this.keyRouter = new SessionKeyRouter(this.policy)
  }

  async [Service.init]() {
    this.policy.hydrate(await this.storage.load())
    this.auth = this.ctx.get('workosAuth', false)
    if (this.auth) this.installControllerGuards()
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

  installControllerGuards() {
    this.patchSessionController(this.ctx.get('sessionController', false))
    this.patchWorkspaceController(this.ctx.get('workspaceController', false))
    this.ctx.on('internal/service', name => {
      if (name === 'sessionController') this.patchSessionController(this.ctx.get(name, false))
      if (name === 'workspaceController') this.patchWorkspaceController(this.ctx.get(name, false))
    })
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
  const authConfig = resolveWorkOSConfig(config.workos)
  if (authConfig.enabled) await ctx.plugin(WorkOSAuthService, authConfig)

  await ctx.plugin(TenantPolicyService, config)
  const service = ctx.get('tenantPolicy')
  ctx.on('session/disposed', session => service.forgetSession(session.id))
}

export default apply
