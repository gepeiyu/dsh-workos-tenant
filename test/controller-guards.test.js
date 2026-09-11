import test from 'node:test'
import assert from 'node:assert/strict'
import { TenantPolicy } from '../src/policy.js'
import { TenantPolicyService } from '../src/service.js'

function testService(identity) {
  const service = Object.create(TenantPolicyService.prototype)
  service.policy = new TenantPolicy()
  service.auth = { currentIdentity: () => identity }
  service.ctx = { effect: () => {} }
  return service
}

test('automatic Session controller guard claims and filters resources', async () => {
  const alice = { organizationId: 'org-1', userId: 'alice', role: 'member' }
  const bob = { organizationId: 'org-1', userId: 'bob', role: 'member' }
  const service = testService(alice)
  service.policy.claimSession(bob, 'session-bob')

  class SessionController {
    async list() {
      return { items: [{ sessionId: 'session-alice' }, { sessionId: 'session-bob' }] }
    }
    async search() {
      return { items: [{ sessionId: 'session-alice' }, { sessionId: 'session-bob' }] }
    }
    async create() { return { sessionId: 'session-alice' } }
    prompt(request) { return { accepted: request.sessionId } }
  }

  const controller = new SessionController()
  service.patchSessionController(controller)
  await controller.create({})
  assert.deepEqual((await controller.list({})).items, [{ sessionId: 'session-alice' }])
  assert.deepEqual((await controller.search({ query: 'x' })).items, [{ sessionId: 'session-alice' }])
  assert.throws(() => controller.prompt({ sessionId: 'session-bob' }), /another user/)
})

test('automatic Workspace controller guard claims and checks resources', async () => {
  const alice = { organizationId: 'org-1', userId: 'alice', role: 'member' }
  const bob = { organizationId: 'org-1', userId: 'bob', role: 'member' }
  const service = testService(alice)
  service.policy.claimWorkspace(bob, 'workspace-bob')

  class WorkspaceController {
    async create() { return { workspace: { workspaceId: 'workspace-alice' }, created: true } }
    rename(request) { return { workspace: { workspaceId: request.workspaceId } } }
  }

  const controller = new WorkspaceController()
  service.patchWorkspaceController(controller)
  await controller.create({ path: '/tmp/alice' })
  assert.deepEqual(service.policy.assertWorkspaceAccess(alice, 'workspace-alice').userId, 'alice')
  assert.throws(() => controller.rename({ workspaceId: 'workspace-bob', title: 'x' }), /another user/)
})
