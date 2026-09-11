import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WorkOSAuthSessionStore,
  identityFromAuthentication,
  resolveWorkOSConfig,
} from '../src/auth.js'

test('WorkOS session cookies resolve only a server-created identity', () => {
  const store = new WorkOSAuthSessionStore({
    cookieSecret: 'a'.repeat(32),
    secureCookies: false,
  })
  const session = store.createSession({
    organizationId: 'org_acme',
    userId: 'user_alice',
    role: 'member',
  })
  const headers = { cookie: session.setCookie.split(';', 1)[0] }

  assert.deepEqual(store.identityFromHeaders(headers), {
    organizationId: 'org_acme',
    userId: 'user_alice',
    role: 'member',
  })
  assert.equal(store.identityFromHeaders({ cookie: 'dsh-workos-session=forged' }), undefined)
})

test('OAuth state requires the matching HttpOnly state cookie', () => {
  const store = new WorkOSAuthSessionStore({
    cookieSecret: 'b'.repeat(32),
    secureCookies: false,
  })
  const { state, setCookie } = store.createState()
  const headers = { cookie: setCookie.split(';', 1)[0] }

  assert.equal(store.consumeState(state, headers), true)
  assert.equal(store.consumeState(state, headers), false)
})

test('WorkOS auth auto-enables only with an organization binding', () => {
  const base = {
    apiKey: 'sk_test',
    clientId: 'client_test',
    redirectUri: 'http://127.0.0.1/auth/callback',
    cookieSecret: 'c'.repeat(32),
  }
  assert.equal(resolveWorkOSConfig(base).enabled, false)
  assert.equal(resolveWorkOSConfig({ ...base, organizationId: 'org_acme' }).enabled, true)
})

test('WorkOS authentication response is reduced to tenant identity', () => {
  assert.deepEqual(identityFromAuthentication({
    user: { id: 'user_alice' },
    organizationId: 'org_acme',
    accessToken: 'not-stored',
  }), {
    organizationId: 'org_acme',
    userId: 'user_alice',
    role: 'member',
  })
})
