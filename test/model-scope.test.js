import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canSeeProvider,
  filterMemberNamespace,
  filterModelCatalog,
  rewriteMemberModelOps,
  tenantCredentialRef,
  tenantProviderPrefix,
} from '../src/model-scope.js'

const alice = { organizationId: 'org-1', userId: 'alice', role: 'member' }
const bob = { organizationId: 'org-1', userId: 'bob', role: 'member' }
const directory = [{
  provider: 'openai',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'openai'],
}]

test('member model mutations are namespaced and cannot target another user', () => {
  const [operation] = rewriteMemberModelOps(alice, directory, 'llm-pi-ai', [{
    op: 'set',
    path: ['providers', 'custom'],
    value: { baseURL: 'https://example.test' },
  }])
  assert.equal(operation.path[1], `${tenantProviderPrefix(alice)}custom`)
  assert.throws(() => rewriteMemberModelOps(alice, directory, 'llm-pi-ai', [{
    op: 'unset',
    path: ['providers', `${tenantProviderPrefix(bob)}custom`],
  }]), /another user/)
  assert.match(tenantCredentialRef(alice, 'OPENAI_API_KEY'), /^DSH_TENANT_[A-F0-9]{16}_OPENAI_API_KEY$/)
})

test('member model views hide providers owned by other users', () => {
  const own = `${tenantProviderPrefix(alice)}own`
  const other = `${tenantProviderPrefix(bob)}other`
  assert.equal(canSeeProvider(alice, own), true)
  assert.equal(canSeeProvider(alice, other), false)
  const descriptor = filterMemberNamespace(alice, directory, {
    ns: 'llm-pi-ai',
    value: { providers: { shared: {}, [own]: {}, [other]: {} } },
    user: { providers: { [own]: {}, [other]: {} } },
  })
  assert.deepEqual(Object.keys(descriptor.value.providers), ['shared', own])
  assert.deepEqual(Object.keys(descriptor.user.providers), [own])

  const catalog = filterModelCatalog(alice, {
    groups: [{ id: 'shared' }, { id: own }, { id: other }],
    failures: [{ id: other }],
  })
  assert.deepEqual(catalog.groups.map(group => group.id), ['shared', own])
  assert.deepEqual(catalog.failures, [])
})
