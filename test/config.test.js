import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ManagedTenantConfigStore,
  normalizeManagedTenantConfig,
  publicManagedTenantConfig,
} from '../src/config.js'

const complete = {
  policy: { adminRoles: ['owner', 'admin'], adminCanManageKeys: false },
  workos: {
    clientId: 'client_test',
    organizationId: 'org_test',
    redirectUri: 'http://127.0.0.1:3080/auth/callback',
    sessionMaxAgeSeconds: 604800,
    secureCookies: false,
    apiKey: 'sk_test',
    cookieSecret: 'c'.repeat(32),
  },
  storage: {
    mode: 'local',
    filePath: '/tmp/tenant-state.json',
    encryptionKey: 'e'.repeat(32),
    d1: {},
  },
}

test('managed configuration is encrypted and secrets are redacted from views', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-workos-config-'))
  const store = new ManagedTenantConfigStore({ filePath: join(directory, 'config.json') })
  store.save(complete)

  const raw = readFileSync(store.filePath, 'utf8')
  assert.equal(raw.includes('sk_test'), false)
  assert.equal(raw.includes('client_test'), false)
  assert.equal(statSync(store.filePath).mode & 0o777, 0o600)
  assert.equal(statSync(store.keyPath).mode & 0o777, 0o600)
  assert.deepEqual(store.load(), complete)

  const view = publicManagedTenantConfig(complete)
  assert.equal(view.workos.apiKeyConfigured, true)
  assert.equal('apiKey' in view.workos, false)
  assert.equal(view.storage.encryptionKeyConfigured, true)
  assert.equal('encryptionKey' in view.storage, false)
})

test('blank write-only fields preserve configured secrets', () => {
  const input = publicManagedTenantConfig(complete)
  input.workos.apiKey = ''
  input.workos.cookieSecret = ''
  input.storage.encryptionKey = ''
  input.storage.d1.apiToken = ''
  const normalized = normalizeManagedTenantConfig(input, complete)
  assert.equal(normalized.workos.apiKey, complete.workos.apiKey)
  assert.equal(normalized.workos.cookieSecret, complete.workos.cookieSecret)
  assert.equal(normalized.storage.encryptionKey, complete.storage.encryptionKey)
})

test('network access defaults to loopback and can be enabled', () => {
  const local = normalizeManagedTenantConfig(complete)
  assert.equal(local.network.allowNetworkAccess, false)
  const network = normalizeManagedTenantConfig({
    ...complete,
    network: { allowNetworkAccess: true },
  })
  assert.equal(network.network.allowNetworkAccess, true)
  assert.equal(publicManagedTenantConfig(network).network.allowNetworkAccess, true)
})

test('workspace root is public, optional, and must be absolute', () => {
  const configured = normalizeManagedTenantConfig({ ...complete, workspace: { root: '/srv/dsh/workspaces' } })
  assert.equal(configured.workspace.root, '/srv/dsh/workspaces')
  assert.equal(publicManagedTenantConfig(configured).workspace.root, '/srv/dsh/workspaces')
  assert.throws(() => normalizeManagedTenantConfig({ ...complete, workspace: { root: 'relative/path' } }), /absolute path/)
  assert.equal(normalizeManagedTenantConfig(complete).workspace.root, undefined)
})

test('branding settings expose only validated public values', () => {
  const configured = normalizeManagedTenantConfig({
    ...complete,
    branding: {
      logoUrl: 'https://example.com/logo.svg',
      name: 'Example Harness',
    },
  })
  assert.deepEqual(configured.branding, {
    logoUrl: 'https://example.com/logo.svg',
    name: 'Example Harness',
  })
  assert.deepEqual(publicManagedTenantConfig(configured).branding, configured.branding)
  assert.throws(() => normalizeManagedTenantConfig({
    ...complete,
    branding: { logoUrl: 'javascript:alert(1)' },
  }), /brand logo URL must use http or https/)
  assert.equal(normalizeManagedTenantConfig(complete).branding.logoUrl, undefined)
})
