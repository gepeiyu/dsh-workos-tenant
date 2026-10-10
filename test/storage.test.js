import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  D1TenantStorage,
  LocalTenantStorage,
  TenantStorageError,
  normalizeBranding,
} from '../src/storage.js'

test('local tenant storage persists and encrypts state when configured', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-tenant-storage-'))
  const filePath = join(directory, 'state.json')
  const storage = new LocalTenantStorage({ filePath, encryptionKey: 'x'.repeat(32) })
  const state = {
    sessions: [{ id: 'session-1', organizationId: 'org-1', userId: 'user-1' }],
    workspaces: [],
    apiKeys: [{ key: 'org-1:user-1:openai', value: 'secret-value' }],
  }
  storage.save(state)
  assert.equal(readFileSync(filePath, 'utf8').includes('secret-value'), false)
  assert.deepEqual(await storage.load(), { version: 1, ...state })
  rmSync(directory, { recursive: true, force: true })
})

test('local tenant storage persists encrypted branding separately from tenant state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-tenant-branding-'))
  const filePath = join(directory, 'state.json')
  const storage = new LocalTenantStorage({ filePath, encryptionKey: 'b'.repeat(32) })
  await storage.saveBranding({ badge: 'ACME', logo: 'data:image/png;base64,AA==', wordmark: null, runningIcon: 'spinner', runningText: '正在处理', heroHeadline: '欢迎使用', heroBadgeText: '内测', heroBadgeVisible: false })
  assert.equal(readFileSync(`${filePath}.branding`, 'utf8').includes('ACME'), false)
  assert.deepEqual(await storage.loadBranding(), {
    badge: 'ACME', logo: 'data:image/png;base64,AA==', wordmark: null,
    runningIcon: 'spinner', runningText: '正在处理',
    heroHeadline: '欢迎使用', heroBadgeText: '内测', heroBadgeVisible: false,
  })
  rmSync(directory, { recursive: true, force: true })
})

test('D1 storage requires encryption for tenant secrets', () => {
  assert.throws(() => new D1TenantStorage({
    accountId: 'account',
    databaseId: 'database',
    apiToken: 'token',
  }), TenantStorageError)
})

test('D1 storage sends encrypted state through the Cloudflare query API', async t => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ success: true, result: [{ results: [] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const storage = new D1TenantStorage({
    accountId: 'account',
    databaseId: 'database',
    apiToken: 'token',
    encryptionKey: 'z'.repeat(32),
    apiBaseUrl: 'https://api.example.test/client/v4',
  })
  await storage.load()
  await storage.save({ sessions: [], workspaces: [], apiKeys: [{ key: 'x', value: 'secret-value' }] })
  await storage.loadBranding()
  await storage.saveBranding({ badge: 'ACME', logo: 'data:image/png;base64,AA==', wordmark: null })

  assert.equal(calls.every(call => call.url.includes('/accounts/account/d1/database/database/query')), true)
  assert.equal(calls.every(call => call.init.headers.authorization === 'Bearer token'), true)
  const insert = calls.find(call => call.body.sql.includes('INSERT INTO'))
  assert.ok(insert)
  assert.equal(insert.body.params[1].includes('secret-value'), false)
  const brandingInsert = calls.find(call => call.body.sql.includes('dsh_tenant_branding') && call.body.sql.includes('INSERT INTO'))
  assert.ok(brandingInsert)
  assert.equal(brandingInsert.body.params[0], 'platform')
  assert.deepEqual(normalizeBranding({}), { badge: 'HARNESS', logo: null, wordmark: null, runningIcon: 'whale', runningText: null, heroHeadline: null, heroBadgeText: null, heroBadgeVisible: true })
  assert.throws(() => normalizeBranding({ logo: 'https://example.com/logo.png' }), TenantStorageError)
})

test('running status defaults upgrade legacy local branding and validate custom values', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-legacy-branding-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'state.json')
  writeFileSync(`${filePath}.branding`, JSON.stringify({ badge: 'LEGACY', logo: null, wordmark: null }))
  const storage = new LocalTenantStorage({ filePath })
  assert.deepEqual(await storage.loadBranding(), {
    badge: 'LEGACY', logo: null, wordmark: null, runningIcon: 'whale', runningText: null,
    heroHeadline: null, heroBadgeText: null, heroBadgeVisible: true,
  })
  assert.equal(normalizeBranding({ runningText: '   ' }).runningText, null)
  assert.throws(() => normalizeBranding({ runningIcon: 'upload' }), TenantStorageError)
  assert.throws(() => normalizeBranding({ runningText: {} }), TenantStorageError)
  assert.throws(() => normalizeBranding({ heroHeadline: {} }), TenantStorageError)
  assert.throws(() => normalizeBranding({ heroBadgeText: 1 }), TenantStorageError)
  assert.throws(() => normalizeBranding({ heroBadgeVisible: 'false' }), TenantStorageError)
  assert.equal(normalizeBranding({ heroHeadline: '   ', heroBadgeText: '' }).heroHeadline, null)
  assert.equal(normalizeBranding({ heroBadgeVisible: false }).heroBadgeVisible, false)
})

test('D1 upgrades an existing branding table and round-trips custom running status', async t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`CREATE TABLE dsh_tenant_branding (
    scope_id TEXT PRIMARY KEY, badge TEXT NOT NULL, logo TEXT, wordmark TEXT, updated_at TEXT NOT NULL
  ); INSERT INTO dsh_tenant_branding VALUES ('platform', 'LEGACY', NULL, NULL, '2026-01-01');`)
  const storage = new D1TenantStorage({
    accountId: 'account', databaseId: 'database', apiToken: 'token', encryptionKey: 'z'.repeat(32),
  })
  const queries = []
  storage.query = async (sql, params = []) => {
    queries.push(sql)
    const statement = db.prepare(sql)
    return /^(SELECT|PRAGMA)/.test(sql) ? statement.all(...params) : (statement.run(...params), [])
  }
  const [legacy] = await Promise.all([storage.loadBranding(), storage.loadBranding()])
  assert.equal(legacy.badge, 'LEGACY')
  assert.equal(legacy.runningIcon, 'whale')
  assert.equal(legacy.runningText, null)
  assert.equal(legacy.heroHeadline, null)
  assert.equal(legacy.heroBadgeText, null)
  assert.equal(legacy.heroBadgeVisible, true)
  assert.equal(queries.filter(sql => sql.startsWith('ALTER TABLE')).length, 5)
  for (const runningIcon of ['spinner', 'dots', 'whale']) {
    const branding = { ...legacy, runningIcon, runningText: '<处理> {duration} $&', heroHeadline: '<欢迎> {name}', heroBadgeText: '内测 $&', heroBadgeVisible: runningIcon === 'whale' }
    await storage.saveBranding(branding)
    assert.deepEqual(await storage.loadBranding(), branding)
  }
  await storage.saveBranding({ ...legacy, runningText: '' })
  assert.equal((await storage.loadBranding()).runningText, null)
})
