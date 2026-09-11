import test from 'node:test'
import assert from 'node:assert/strict'
import { TenantPolicy, TenantError } from '../src/policy.js'
import { TenantSessionGuard, TenantWorkspaceGuard } from '../src/guards.js'

const alice = { organizationId: 'org_acme', userId: 'user_alice', role: 'member' }
const bob = { organizationId: 'org_acme', userId: 'user_bob', role: 'member' }

function expectTenantError(fn, code) {
  assert.throws(fn, error => error instanceof TenantError && error.code === code)
}

test('session guard claims creation results and filters list/search', () => {
  const policy = new TenantPolicy()
  const guard = new TenantSessionGuard(policy)
  policy.claimSession(alice, 'alice-existing')
  policy.claimSession(bob, 'bob-existing')

  guard.claimCreated(alice, {}, { sessionId: 'alice-new' })
  assert.deepEqual(
    guard.filterList(alice, {
      items: [
        { sessionId: 'alice-existing' },
        { sessionId: 'bob-existing' },
        { sessionId: 'alice-new' },
      ],
    }).items.map(item => item.sessionId),
    ['alice-existing', 'alice-new'],
  )
  assert.deepEqual(
    guard.filterSearch(alice, {
      items: [{ sessionId: 'bob-existing', snippet: 'hidden' }],
    }).items,
    [],
  )
})

test('session guard protects subagent addresses and fork ownership', () => {
  const policy = new TenantPolicy()
  const guard = new TenantSessionGuard(policy)
  policy.claimSession(alice, 'parent')
  guard.claimForked(alice, { sessionId: 'parent' }, { sessionId: 'child' })
  guard.authorizeAddress(alice, {
    address: { kind: 'subagent', parentSessionId: 'parent', childSessionId: 'child' },
  })
  expectTenantError(() => guard.authorize(alice, { sessionId: 'unknown' }), 'SESSION_NOT_REGISTERED')
})

test('workspace baseline hides other users and their sessions', () => {
  const policy = new TenantPolicy()
  const guard = new TenantWorkspaceGuard(policy)
  policy.claimSession(alice, 'alice-session')
  policy.claimSession(bob, 'bob-session')
  policy.claimWorkspace(alice, 'workspace-alice')
  policy.claimWorkspace(bob, 'workspace-bob')

  const baseline = guard.filterBaseline(alice, {
    items: [
      { workspaceId: 'workspace-alice', sessionIds: ['alice-session'] },
      { workspaceId: 'workspace-bob', sessionIds: ['bob-session'] },
    ],
    archivedSessionIds: ['alice-session', 'bob-session'],
  })

  assert.deepEqual(baseline.items.map(item => item.workspaceId), ['workspace-alice'])
  assert.deepEqual(baseline.archivedSessionIds, ['alice-session'])
})
