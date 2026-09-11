import { TenantPolicy } from './policy.js'

function requirePolicy(policy) {
  if (!(policy instanceof TenantPolicy)) {
    throw new TypeError('A TenantPolicy instance is required')
  }
  return policy
}

function sessionIdFromAddress(address) {
  if (!address || typeof address !== 'object') return []
  if (address.kind === 'session') return [address.sessionId]
  if (address.kind === 'subagent') return [address.parentSessionId, address.childSessionId]
  return []
}

/**
 * Pure authorization adapter for @deepseek-ai/dsh-api-session-controller.
 * A host decorator calls these methods before or after the matching controller
 * operation; this class neither owns HTTP routes nor authenticates requests.
 */
export class TenantSessionGuard {
  constructor(policy) {
    this.policy = requirePolicy(policy)
  }

  authorize(identity, request) {
    return this.policy.assertSessionAccess(identity, request?.sessionId)
  }

  authorizeAddress(identity, request) {
    const ids = sessionIdFromAddress(request?.address)
    if (ids.length === 0) throw new TypeError('A supported session address is required')
    return ids.map(sessionId => this.policy.assertSessionAccess(identity, sessionId))
  }

  filterList(identity, value) {
    return {
      ...value,
      items: (value?.items ?? []).filter(item =>
        this.policy.canAccessSession(identity, item.sessionId)),
    }
  }

  filterSearch(identity, value) {
    return {
      ...value,
      items: (value?.items ?? []).filter(item =>
        this.policy.canAccessSession(identity, item.sessionId)),
    }
  }

  claimCreated(identity, request, value) {
    if (request?.workspaceId) {
      this.policy.assertWorkspaceAccess(identity, request.workspaceId)
    }
    this.policy.claimSession(identity, value?.sessionId)
    return value
  }

  claimForked(identity, request, value) {
    this.policy.assertSessionAccess(identity, request?.sessionId)
    this.policy.claimSession(identity, value?.sessionId)
    return value
  }
}

/** Pure authorization adapter for the DSH Workspace controller. */
export class TenantWorkspaceGuard {
  constructor(policy) {
    this.policy = requirePolicy(policy)
  }

  authorize(identity, request) {
    return this.policy.assertWorkspaceAccess(identity, request?.workspaceId)
  }

  authorizeSessionMutation(identity, request) {
    if (request?.workspaceId) this.policy.assertWorkspaceAccess(identity, request.workspaceId)
    return this.policy.assertSessionAccess(identity, request?.sessionId)
  }

  claimCreated(identity, value) {
    this.policy.claimWorkspace(identity, value?.workspace?.workspaceId)
    return value
  }

  filterBaseline(identity, baseline) {
    const items = (baseline?.items ?? [])
      .filter(workspace => this.policy.canAccessWorkspace(identity, workspace.workspaceId))
      .map(workspace => ({
        ...workspace,
        sessionIds: (workspace.sessionIds ?? []).filter(sessionId =>
          this.policy.canAccessSession(identity, sessionId)),
      }))

    return {
      ...baseline,
      items,
      archivedSessionIds: (baseline?.archivedSessionIds ?? []).filter(sessionId =>
        this.policy.canAccessSession(identity, sessionId)),
    }
  }
}
