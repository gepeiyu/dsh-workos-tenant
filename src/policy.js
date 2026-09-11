export class TenantError extends Error {
  constructor(code, message, status = 403) {
    super(message)
    this.name = 'TenantError'
    this.code = code
    this.status = status
  }
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TenantError('INVALID_IDENTITY', `${field} must be a non-empty string`, 400)
  }
  return value.trim()
}

/**
 * Normalize an identity that has already been authenticated by the host.
 * Authentication and token verification intentionally live outside this plugin.
 */
export function normalizeIdentity(input) {
  if (!input || typeof input !== 'object') {
    throw new TenantError('INVALID_IDENTITY', 'Identity must be an object', 400)
  }

  return Object.freeze({
    organizationId: requiredString(input.organizationId ?? input.organization_id, 'organizationId'),
    userId: requiredString(input.userId ?? input.user_id, 'userId'),
    role: requiredString(input.role ?? 'member', 'role'),
  })
}

function ownerKey(identity) {
  return `${identity.organizationId}:${identity.userId}`
}

function resourceRecord(identity) {
  return {
    organizationId: identity.organizationId,
    userId: identity.userId,
    owner: ownerKey(identity),
    createdAt: new Date().toISOString(),
  }
}

export class TenantPolicy {
  constructor(options = {}) {
    this.adminRoles = new Set(options.adminRoles ?? ['owner', 'admin'])
    this.adminCanManageKeys = options.adminCanManageKeys ?? false
    this.sessions = new Map()
    this.workspaces = new Map()
    this.apiKeys = new Map()
    this.onChange = typeof options.onChange === 'function' ? options.onChange : undefined
    this.hydrate(options.initialState)
  }

  snapshot() {
    return {
      version: 1,
      sessions: [...this.sessions].map(([id, record]) => ({ id, ...record })),
      workspaces: [...this.workspaces].map(([id, record]) => ({ id, ...record })),
      apiKeys: [...this.apiKeys].map(([key, record]) => ({ key, ...record })),
    }
  }

  hydrate(state = {}) {
    this.sessions.clear()
    this.workspaces.clear()
    this.apiKeys.clear()
    for (const record of state.sessions ?? []) {
      if (record?.id) this.sessions.set(record.id, { ...record })
    }
    for (const record of state.workspaces ?? []) {
      if (record?.id) this.workspaces.set(record.id, { ...record })
    }
    for (const record of state.apiKeys ?? []) {
      if (record?.key) {
        const { key, ...value } = record
        this.apiKeys.set(key, value)
      }
    }
  }

  persist() {
    if (!this.onChange) return
    try {
      const result = this.onChange(this.snapshot())
      if (result?.catch) result.catch(() => {})
    } catch {
      // Persistence errors are surfaced by the storage service health path.
    }
  }

  isAdmin(identity) {
    return this.adminRoles.has(identity.role)
  }

  claimSession(identity, sessionId) {
    identity = normalizeIdentity(identity)
    const id = requiredString(sessionId, 'sessionId')
    const existing = this.sessions.get(id)
    if (!existing) {
      this.sessions.set(id, resourceRecord(identity))
      this.persist()
      return { ...this.sessions.get(id) }
    }
    if (existing.organizationId !== identity.organizationId) {
      throw new TenantError('SESSION_ORGANIZATION_MISMATCH', 'Session belongs to another organization')
    }
    if (existing.userId !== identity.userId && !this.isAdmin(identity)) {
      throw new TenantError('SESSION_FORBIDDEN', 'Session belongs to another user')
    }
    return { ...existing }
  }

  assertSessionAccess(identity, sessionId) {
    identity = normalizeIdentity(identity)
    const id = requiredString(sessionId, 'sessionId')
    const existing = this.sessions.get(id)
    if (!existing) {
      throw new TenantError('SESSION_NOT_REGISTERED', 'Session has no tenant owner', 404)
    }
    if (existing.organizationId !== identity.organizationId) {
      throw new TenantError('SESSION_ORGANIZATION_MISMATCH', 'Session belongs to another organization')
    }
    if (existing.userId !== identity.userId && !this.isAdmin(identity)) {
      throw new TenantError('SESSION_FORBIDDEN', 'Session belongs to another user')
    }
    return { ...existing }
  }

  claimWorkspace(identity, workspaceId) {
    identity = normalizeIdentity(identity)
    const id = requiredString(workspaceId, 'workspaceId')
    const existing = this.workspaces.get(id)
    if (!existing) {
      this.workspaces.set(id, resourceRecord(identity))
      this.persist()
      return { ...this.workspaces.get(id) }
    }
    if (existing.organizationId !== identity.organizationId) {
      throw new TenantError('WORKSPACE_ORGANIZATION_MISMATCH', 'Workspace belongs to another organization')
    }
    if (existing.userId !== identity.userId && !this.isAdmin(identity)) {
      throw new TenantError('WORKSPACE_FORBIDDEN', 'Workspace belongs to another user')
    }
    return { ...existing }
  }

  assertWorkspaceAccess(identity, workspaceId) {
    identity = normalizeIdentity(identity)
    const id = requiredString(workspaceId, 'workspaceId')
    const existing = this.workspaces.get(id)
    if (!existing) {
      throw new TenantError('WORKSPACE_NOT_REGISTERED', 'Workspace has no tenant owner', 404)
    }
    if (existing.organizationId !== identity.organizationId) {
      throw new TenantError('WORKSPACE_ORGANIZATION_MISMATCH', 'Workspace belongs to another organization')
    }
    if (existing.userId !== identity.userId && !this.isAdmin(identity)) {
      throw new TenantError('WORKSPACE_FORBIDDEN', 'Workspace belongs to another user')
    }
    return { ...existing }
  }

  forgetSession(sessionId) {
    if (this.sessions.delete(requiredString(sessionId, 'sessionId'))) this.persist()
  }

  forgetWorkspace(workspaceId) {
    if (this.workspaces.delete(requiredString(workspaceId, 'workspaceId'))) this.persist()
  }

  canAccessSession(identity, sessionId) {
    try {
      this.assertSessionAccess(identity, sessionId)
      return true
    } catch (error) {
      if (error instanceof TenantError) return false
      throw error
    }
  }

  canAccessWorkspace(identity, workspaceId) {
    try {
      this.assertWorkspaceAccess(identity, workspaceId)
      return true
    } catch (error) {
      if (error instanceof TenantError) return false
      throw error
    }
  }

  listOwnedSessions(identity) {
    identity = normalizeIdentity(identity)
    return [...this.sessions.entries()]
      .filter(([, record]) => record.organizationId === identity.organizationId &&
        (record.userId === identity.userId || this.isAdmin(identity)))
      .map(([id, record]) => ({ id, ...record }))
  }

  listOwnedWorkspaces(identity) {
    identity = normalizeIdentity(identity)
    return [...this.workspaces.entries()]
      .filter(([, record]) => record.organizationId === identity.organizationId &&
        (record.userId === identity.userId || this.isAdmin(identity)))
      .map(([id, record]) => ({ id, ...record }))
  }

  setApiKey(identity, provider, apiKey, targetUserId = identity.userId) {
    identity = normalizeIdentity(identity)
    const providerId = requiredString(provider, 'provider')
    const key = requiredString(apiKey, 'apiKey')
    const userId = requiredString(targetUserId, 'targetUserId')
    if (userId !== identity.userId && (!this.isAdmin(identity) || !this.adminCanManageKeys)) {
      throw new TenantError('KEY_FORBIDDEN', 'Only an authorized organization admin can manage another user key')
    }
    this.apiKeys.set(`${identity.organizationId}:${userId}:${providerId}`, {
      organizationId: identity.organizationId,
      userId,
      provider: providerId,
      value: key,
      updatedAt: new Date().toISOString(),
    })
    this.persist()
  }

  resolveApiKey(identity, provider, targetUserId = identity.userId) {
    identity = normalizeIdentity(identity)
    const providerId = requiredString(provider, 'provider')
    const userId = requiredString(targetUserId, 'targetUserId')
    if (userId !== identity.userId && !this.isAdmin(identity)) {
      throw new TenantError('KEY_FORBIDDEN', 'Cannot resolve another user key')
    }
    const record = this.apiKeys.get(`${identity.organizationId}:${userId}:${providerId}`)
    if (!record) {
      throw new TenantError('KEY_NOT_CONFIGURED', `No API key configured for ${providerId}`, 404)
    }
    return record.value
  }

  resolveApiKeyForSession(sessionId, provider) {
    const id = requiredString(sessionId, 'sessionId')
    const providerId = requiredString(provider, 'provider')
    const owner = this.sessions.get(id)
    if (!owner) {
      throw new TenantError('SESSION_NOT_REGISTERED', 'Session has no tenant owner', 404)
    }
    const record = this.apiKeys.get(`${owner.organizationId}:${owner.userId}:${providerId}`)
    if (!record) {
      throw new TenantError('KEY_NOT_CONFIGURED', `No API key configured for ${providerId}`, 404)
    }
    return record.value
  }

  describeApiKeys(identity) {
    identity = normalizeIdentity(identity)
    return [...this.apiKeys.values()]
      .filter(record => record.organizationId === identity.organizationId &&
        (record.userId === identity.userId || this.isAdmin(identity)))
      .map(record => ({
        userId: record.userId,
        provider: record.provider,
        configured: true,
        updatedAt: record.updatedAt,
      }))
  }
}

export class SessionKeyRouter {
  constructor(policy) {
    if (!(policy instanceof TenantPolicy)) throw new TypeError('SessionKeyRouter requires a TenantPolicy')
    this.policy = policy
  }

  resolve({ sessionId, provider }) {
    return this.policy.resolveApiKeyForSession(sessionId, provider)
  }
}
