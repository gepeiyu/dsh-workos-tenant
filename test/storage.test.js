import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  await storage.saveBranding({ badge: 'ACME', logo: 'data:image/png;base64,AA==', wordmark: null })
  assert.equal(readFileSync(`${filePath}.branding`, 'utf8').includes('ACME'), false)
  assert.deepEqual(await storage.loadBranding(), {
    badge: 'ACME', logo: 'data:image/png;base64,AA==', wordmark: null,
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
  assert.deepEqual(normalizeBranding({}), { badge: 'HARNESS', logo: null, wordmark: null })
  assert.throws(() => normalizeBranding({ logo: 'https://example.com/logo.png' }), TenantStorageError)
})
