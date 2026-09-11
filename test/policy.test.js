import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TenantError,
  TenantPolicy,
  SessionKeyRouter,
  normalizeIdentity,
} from '../src/policy.js'

const alice = { organizationId: 'org_acme', userId: 'user_alice', role: 'member' }
const bob = { organizationId: 'org_acme', userId: 'user_bob', role: 'member' }
const admin = { organizationId: 'org_acme', userId: 'user_admin', role: 'admin' }

function expectTenantError(fn, code) {
  assert.throws(fn, error => error instanceof TenantError && error.code === code)
}

test('host-provided identity is normalized without authenticating it', () => {
  assert.deepEqual(normalizeIdentity({
    organization_id: 'org_acme',
    user_id: 'user_alice',
    role: 'member',
    ignoredToken: 'never-consumed-by-plugin',
  }), alice)
  expectTenantError(() => normalizeIdentity({ organizationId: 'org_acme' }), 'INVALID_IDENTITY')
})

test('sessions are claimed by the first user and cannot cross users', () => {
  const policy = new TenantPolicy()
  policy.claimSession(alice, 'session-1')
  policy.assertSessionAccess(alice, 'session-1')
  expectTenantError(() => policy.assertSessionAccess(bob, 'session-1'), 'SESSION_FORBIDDEN')
  expectTenantError(() => policy.claimSession({ ...bob, organizationId: 'org_other' }, 'session-1'), 'SESSION_ORGANIZATION_MISMATCH')
})

test('organization admins can inspect sessions but cannot cross organizations', () => {
  const policy = new TenantPolicy()
  policy.claimSession(alice, 'session-1')
  assert.equal(policy.assertSessionAccess(admin, 'session-1').userId, 'user_alice')
  expectTenantError(() => policy.assertSessionAccess({ ...admin, organizationId: 'org_other' }, 'session-1'), 'SESSION_ORGANIZATION_MISMATCH')
})

test('session key routing derives the key from the registered owner', () => {
  const policy = new TenantPolicy()
  const router = new SessionKeyRouter(policy)
  policy.claimSession(alice, 'session-alice')
  policy.claimSession(bob, 'session-bob')
  policy.setApiKey(alice, 'openai', 'alice-secret')
  policy.setApiKey(bob, 'openai', 'bob-secret')

  assert.equal(router.resolve({ sessionId: 'session-alice', provider: 'openai' }), 'alice-secret')
  assert.equal(router.resolve({ sessionId: 'session-bob', provider: 'openai' }), 'bob-secret')
  expectTenantError(() => router.resolve({ sessionId: 'session-alice', provider: 'anthropic' }), 'KEY_NOT_CONFIGURED')
  expectTenantError(() => router.resolve({ sessionId: 'session-unknown', provider: 'openai' }), 'SESSION_NOT_REGISTERED')
})

test('members cannot manage another user key', () => {
  const policy = new TenantPolicy()
  expectTenantError(() => policy.setApiKey(alice, 'openai', 'secret', bob.userId), 'KEY_FORBIDDEN')
  const managedPolicy = new TenantPolicy({ adminCanManageKeys: true })
  managedPolicy.setApiKey(admin, 'openai', 'admin-managed-secret', bob.userId)
  assert.equal(managedPolicy.resolveApiKey(admin, 'openai', bob.userId), 'admin-managed-secret')
})
