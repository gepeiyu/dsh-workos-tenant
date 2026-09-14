import test from 'node:test'
import assert from 'node:assert/strict'
import { TenantPolicy } from '../src/policy.js'
import { TenantPolicyService } from '../src/service.js'

function testService(identity) {
  const service = Object.create(TenantPolicyService.prototype)
  service.policy = new TenantPolicy()
  service.auth = { currentIdentity: () => identity }
  service.ctx = { effect: setup => setup(), get: () => ({ list: async () => [{ header: { id: 'legacy-session' } }, { header: { id: 'session-bob' } }] }) }
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
  await assert.rejects(controller.create({sessionId: 'session-bob'}), /another user/)
  await assert.rejects(controller.create({sessionId: 'legacy-session'}), /no tenant owner/)
  await controller.create({sessionId: 'new-session'})
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

test('resolving an existing workspace cannot claim its historical ownership', async () => {
  const service = testService({organizationId: 'org-1', userId: 'alice', role: 'owner'})
  class WorkspaceController {
    async create() { return {workspace: {workspaceId:'legacy-workspace'}, created:false} }
  }
  const controller = new WorkspaceController()
  service.patchWorkspaceController(controller)
  await assert.rejects(controller.create({path:'/tmp/legacy'}), /no tenant owner/)
  assert.equal(service.policy.workspaces.has('legacy-workspace'),false)
})

test('stream guards retain the identity captured when the stream opens', async () => {
  const alice = { organizationId: 'org-1', userId: 'alice', role: 'member' }
  const bob = { organizationId: 'org-1', userId: 'bob', role: 'member' }
  const service = testService(alice)
  service.policy.claimSession(alice, 'session-alice')
  service.policy.claimSession(bob, 'session-bob')
  service.policy.claimWorkspace(alice, 'workspace-alice')
  service.policy.claimWorkspace(bob, 'workspace-bob')

  class SessionController {
    async *control() {
      yield { type: 'baseline', value: { queues: { 'session-alice': 1, 'session-bob': 1 } } }
      yield { sessionId: 'session-bob', value: 'hidden' }
      yield { sessionId: 'session-alice', value: 'visible' }
    }
  }
  class WorkspaceController {
    async *follow() {
      yield { type: 'baseline', value: {
        items: [
          { workspaceId: 'workspace-alice', sessionIds: ['session-alice'] },
          { workspaceId: 'workspace-bob', sessionIds: ['session-bob'] },
        ],
        archivedSessionIds: ['session-alice', 'session-bob'],
      } }
    }
  }

  const sessions = new SessionController()
  const workspaces = new WorkspaceController()
  service.patchSessionController(sessions)
  service.patchWorkspaceController(workspaces)
  const sessionStream = sessions.control()
  const workspaceStream = workspaces.follow()
  service.auth.currentIdentity = () => bob

  const sessionFrames = []
  for await (const frame of sessionStream) sessionFrames.push(frame)
  const workspaceFrames = []
  for await (const frame of workspaceStream) workspaceFrames.push(frame)
  assert.deepEqual(sessionFrames, [
    { type: 'baseline', value: { queues: { 'session-alice': 1 }, jobs: {}, projections: {} } },
    { sessionId: 'session-alice', value: 'visible' },
  ])
  assert.deepEqual(workspaceFrames, [{ type: 'baseline', value: {
    items: [{ workspaceId: 'workspace-alice', sessionIds: ['session-alice'] }],
    archivedSessionIds: ['session-alice'],
  } }])
})
