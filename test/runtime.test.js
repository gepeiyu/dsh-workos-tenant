import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { AsyncLocalStorage } from 'node:async_hooks'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TenantPolicyService } from '../src/service.js'
import { WorkOSAuthService } from '../src/auth.js'
import { LocalTenantStorage } from '../src/storage.js'

const alice = { organizationId: 'org_test', userId: 'alice', role: 'owner' }
const bob = { organizationId: 'org_test', userId: 'bob', role: 'admin' }

test('real Cordis lifecycle keeps guards installed with late authentication and across detach', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const directory = mkdtempSync(join(tmpdir(), 'dsh-tenant-runtime-'))
  const identity = new AsyncLocalStorage()
  class Sessions {
    async create(request) {
      ctx.emit('session/created', { id: request.sessionId, header: {} })
      return { sessionId: request.sessionId }
    }
    async list() { return { items: [{ sessionId: 'alice-session' }, { sessionId: 'bob-session' }] } }
    prompt(request) { return request.sessionId }
  }
  class Workspaces {
    async *follow() {
      yield { type: 'baseline', value: {
        items: [
          { workspaceId: 'alice-workspace', sessionIds: ['alice-session', 'bob-session'] },
          { workspaceId: 'bob-workspace', sessionIds: ['bob-session'] },
        ], archivedSessionIds: [],
      } }
    }
  }
  class Gateway {
    async *openRemoteEvents() {
      yield { type: 'ready' }
      yield { type: 'emit', event: 'api-session/added', args: [{ sessionId: 'alice-session' }] }
      yield { type: 'emit', event: 'api-session/added', args: [{ sessionId: 'bob-session' }] }
      yield { type: 'waterfall', agentId: 'bob-session' }
    }
  }
  class Files {
    read(scope) { return scope.sessionId }
    async *changes(scope) { yield scope.sessionId }
  }
  const sessions = new Sessions()
  const workspaces = new Workspaces()
  const gateway = new Gateway()
  const files = new Files()
  const originalPrompt = sessions.prompt
  ctx.provide('sessionController', sessions)
  ctx.provide('workspaceController', workspaces)
  ctx.provide('typertGateway', gateway)
  ctx.provide('workspaceFiles', files)
  ctx.provide('sessionPersistence', { async list() { return [] } })
  const fiber = ctx.plugin(TenantPolicyService, { storage: { filePath: join(directory, 'state.json') } })
  await fiber.await()
  const tenant = ctx.tenantPolicy
  assert.equal(tenant.runtimeGuardsInstalled, undefined)
  ctx.provide('workosAuth', { currentIdentity: () => identity.getStore() })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(tenant.runtimeGuardsInstalled, true)
  assert.notEqual(sessions.prompt, originalPrompt)
  tenant.claimWorkspace(alice, 'alice-workspace')
  tenant.claimWorkspace(bob, 'bob-workspace')
  await identity.run(alice, () => sessions.create({ sessionId: 'alice-session' }))
  await identity.run(bob, () => sessions.create({ sessionId: 'bob-session' }))
  assert.deepEqual(await identity.run(alice, () => sessions.list({})), { items: [{ sessionId: 'alice-session' }] })
  assert.throws(() => identity.run(bob, () => sessions.prompt({ sessionId: 'alice-session' })), /another user/)
  assert.equal(identity.run(alice, () => files.read({sessionId:'alice-session'})), 'alice-session')
  assert.throws(() => identity.run(bob, () => files.read({sessionId:'alice-session'})), /another user/)
  assert.throws(() => identity.run(bob, () => files.changes({sessionId:'alice-session'})), /another user/)
  const stream = identity.run(alice, () => workspaces.follow())
  const frames = []
  for await (const frame of stream) frames.push(frame)
  assert.deepEqual(frames[0].value.items, [{ workspaceId: 'alice-workspace', sessionIds: ['alice-session'] }])
  const events = []
  const eventStream = identity.run(alice, () => gateway.openRemoteEvents({}, new AbortController().signal))
  for await (const frame of eventStream) events.push(frame)
  assert.equal(events.length, 2)
  assert.equal(events[1].args[0].sessionId, 'alice-session')
  ctx.emit('session/disposed', { id: 'alice-session' })
  assert.equal(tenant.assertSessionAccess(alice, 'alice-session').userId, alice.userId)
  const saved = await new LocalTenantStorage({ filePath: join(directory, 'state.json') }).load()
  assert.equal(saved.sessions.find(row => row.id === 'alice-session').userId, alice.userId)
  await fiber.dispose()
  assert.equal(sessions.prompt, originalPrompt)
})

test('authentication gate survives effect registration and binds WebSocket callbacks to their user', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  class Connection {
    requestRejection() { return undefined }
    authorizeIndex() { return true }
  }
  const routes = new Map()
  ctx.provide('connection', new Connection())
  ctx.provide('webServer', {
    register(route) { routes.set(route.path, route); return () => routes.delete(route.path) },
  })
  await ctx.plugin(WorkOSAuthService, { client: {}, cookieSecret: 'x'.repeat(32) }).await()
  const auth = ctx.workosAuth
  assert.equal(ctx.connection.requestRejection({ headers: {} }), 401)
  const makeRequest = user => {
    const session = auth.sessions.createSession(user)
    return { socket: new EventEmitter(), headers: {
      cookie: session.setCookie.split(';')[0], upgrade: 'websocket',
    } }
  }
  const aliceRequest = makeRequest(alice)
  const bobRequest = makeRequest(bob)
  assert.equal(ctx.connection.requestRejection(aliceRequest), undefined)
  assert.equal(ctx.connection.requestRejection(bobRequest), undefined)
  const seen = []
  aliceRequest.socket.on('data', () => seen.push(auth.currentIdentity().userId))
  bobRequest.socket.on('data', () => seen.push(auth.currentIdentity().userId))
  auth.identityContext.run(undefined, () => {
    aliceRequest.socket.emit('data')
    bobRequest.socket.emit('data')
    aliceRequest.socket.emit('data')
  })
  assert.deepEqual(seen, ['alice', 'bob', 'alice'])
})

test('legacy migration registers only unowned resources and survives restart', async () => {
  const ctx = new Context()
  const directory = mkdtempSync(join(tmpdir(), 'dsh-tenant-migration-'))
  const tenant = new TenantPolicyService(ctx, { storage: { filePath: join(directory, 'state.json') } })
  ctx.provide('sessionPersistence', { async list() { return [{ header: { id: 'old-session' }, revision: 'old' }, { header: { id: 'bob-session' }, revision: 'bob' }] } })
  ctx.provide('workspaceRegistry', { list() { return [{ id: 'old-workspace' }, { id: 'bob-workspace' }] } })
  tenant.claimSession(bob, 'bob-session')
  tenant.claimWorkspace(bob, 'bob-workspace')
  assert.deepEqual(await tenant.legacyResources(alice), { sessions: 1, workspaces: 1 })
  assert.deepEqual(await tenant.legacyResources(alice, true), { sessions: 1, workspaces: 1 })
  assert.equal(tenant.assertSessionAccess(alice, 'old-session').userId, alice.userId)
  assert.equal(tenant.assertWorkspaceAccess(alice, 'old-workspace').userId, alice.userId)
  assert.equal(tenant.assertSessionAccess(bob, 'bob-session').userId, bob.userId)
  assert.equal(tenant.assertWorkspaceAccess(bob, 'bob-workspace').userId, bob.userId)
  assert.deepEqual(await tenant.legacyResources(alice, true), { sessions: 0, workspaces: 0 })
  await assert.rejects(tenant.legacyResources({ ...bob, role: 'member' }, true), /Administrator/)
  const saved = await tenant.storage.load()
  assert.equal(saved.sessions.find(row => row.id === 'old-session').userId, alice.userId)
  await ctx.fiber.dispose()
})
