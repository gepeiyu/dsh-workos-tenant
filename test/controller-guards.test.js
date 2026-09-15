import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TenantPolicy } from '../src/policy.js'
import { TenantPolicyService } from '../src/service.js'

function testService(identity, options = {}) {
  const service = Object.create(TenantPolicyService.prototype)
  service.policy = new TenantPolicy()
  service.config = options.config ?? {}
  service.auth = { currentIdentity: () => identity }
  service.ctx = { effect: setup => setup(), get: name => options.services?.[name] ?? ({ list: async () => [{ header: { id: 'legacy-session' } }, { header: { id: 'session-bob' } }] }) }
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

test('configured workspace root guards workspace, session, picker, and file paths', async () => {
  const alice = { organizationId: 'org-1', userId: 'alice', role: 'member' }
  const base = mkdtempSync(join(tmpdir(), 'dsh-tenant-scoped-'))
  const root = join(base, 'org-1', 'alice')
  const project = join(root, 'project')
  const outside = mkdtempSync(join(tmpdir(), 'dsh-tenant-foreign-'))
  mkdirSync(project, { recursive: true })
  const headers = new Map([
    ['inside-session', { id: 'inside-session', cwd: project }],
    ['outside-session', { id: 'outside-session', cwd: outside }],
  ])
  const workspaces = new Map([
    ['inside-workspace', { id: 'inside-workspace', path: project }],
    ['outside-workspace', { id: 'outside-workspace', path: outside }],
  ])
  const service = testService(alice, {
    config: { workspace: { root: base } },
    services: {
      sessions: { get: id => ({ header: headers.get(id) }) },
      sessionPersistence: { stat: async id => ({ header: headers.get(id) }), list: async () => [] },
      workspaceRegistry: { get: id => workspaces.get(id) },
    },
  })
  service.policy.claimSession(alice, 'inside-session')
  service.policy.claimSession(alice, 'outside-session')
  service.policy.claimWorkspace(alice, 'inside-workspace')
  service.policy.claimWorkspace(alice, 'outside-workspace')

  class SessionController {
    list() { return { items: [...headers.values()].map(header => ({sessionId:header.id,cwd:header.cwd})) } }
    create(request) { return { sessionId: request.sessionId ?? 'created-session' } }
    prompt(request) { return request.sessionId }
  }
  const sessions = new SessionController()
  service.patchSessionController(sessions)
  assert.deepEqual((await sessions.list({})).items.map(row => row.sessionId), ['inside-session'])
  await assert.rejects(sessions.prompt({sessionId:'outside-session'}), /outside/)
  assert.throws(() => sessions.create({sessionId:'new-outside',cwd:outside}), /outside/)
  await sessions.create({sessionId:'new-inside',cwd:join(root,'new-project')})
  await sessions.create({sessionId:'new-picker',cwd:'/.dsh-workspace/project'})

  class WorkspaceController { create(request) { return {workspace:{workspaceId:'created-workspace',path:request.path},created:true} } }
  const workspaceController = new WorkspaceController()
  service.patchWorkspaceController(workspaceController)
  assert.throws(() => workspaceController.create({path:outside}), /outside/)
  await workspaceController.create({path:join(root,'created')})
  await workspaceController.create({path:'/.dsh-workspace/project'})

  class DirectoryPickerController {
    list(path) { return {path,home:base,crumbs:[{path:base},{path:root}],entries:[{path:project},{path:outside}]} }
    createDirectory(path, name) { return join(path, name) }
    pick() { return Promise.resolve(outside) }
  }
  const picker = new DirectoryPickerController()
  service.patchDirectoryPicker(picker)
  const listing = await picker.list()
  assert.equal(listing.path, '/.dsh-workspace')
  assert.equal(listing.home, '/.dsh-workspace')
  assert.deepEqual(listing.crumbs,[{path:'/.dsh-workspace'}])
  assert.deepEqual(listing.entries,[{path:'/.dsh-workspace/project'}])
  assert.equal(await picker.createDirectory('/.dsh-workspace','child'), '/.dsh-workspace/child')
  assert.equal((await picker.list('/.dsh-workspace/project')).path, '/.dsh-workspace/project')
  await assert.rejects(picker.pick(), /outside/)

  class PickerWithInsidePath {
    pick() { return Promise.resolve(project) }
  }
  const insidePicker = new PickerWithInsidePath()
  service.patchDirectoryPicker(insidePicker)
  assert.equal(await insidePicker.pick(), '/.dsh-workspace/project')

  class WorkspaceFiles { read(scope, path) { return join(scope.workspaceRoot,path) } }
  const files = new WorkspaceFiles()
  service.patchWorkspaceFiles(files)
  assert.equal(files.read({sessionId:'inside-session',workspaceRoot:project},'file.txt'),join(project,'file.txt'))
  assert.throws(() => files.read({sessionId:'inside-session',workspaceRoot:project},outside), /outside/)
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
