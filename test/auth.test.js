import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import {
  accountFromAuthentication,
  WorkOSAuthService,
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

test('network login keeps AuthKit callbacks on the requested host', async () => {
  const sessions = new WorkOSAuthSessionStore({
    cookieSecret: 'n'.repeat(32),
    secureCookies: false,
  })
  const service = Object.create(WorkOSAuthService.prototype)
  service.sessions = sessions
  service.config = {
    clientId: 'client_test',
    organizationId: 'org_acme',
    redirectUri: 'http://127.0.0.1:3080/auth/callback',
  }
  service.management = {
    effectiveConfig: { network: { allowNetworkAccess: true } },
  }
  let authorization
  service.client = {
    userManagement: {
      getAuthorizationUrl: options => {
        authorization = options
        return 'https://auth.example/authorize'
      },
      authenticateWithCode: async () => ({
        user: { id: 'user_alice', email: 'alice@example.com' },
        organizationId: 'org_acme',
        accessToken: `header.${Buffer.from(JSON.stringify({ sid: 'session_workos' })).toString('base64url')}.signature`,
      }),
      getLogoutUrl: ({ returnTo }) => `https://auth.example/logout?return_to=${encodeURIComponent(returnTo)}`,
    },
  }
  service.ctx = {
    connection: { authenticatedUrl: url => url },
  }

  let loginResponse
  await service.login({
    headers: { host: '172.20.5.172:3080' },
    socket: { encrypted: false },
  }, {
    writeHead(status, headers) { loginResponse = { status, headers } },
    end() {},
  })
  assert.equal(authorization.redirectUri, 'http://172.20.5.172:3080/auth/callback')
  assert.equal(loginResponse.status, 302)

  let callbackResponse
  const requestHeaders = {
    host: '172.20.5.172:3080',
    cookie: loginResponse.headers['set-cookie'].split(';', 1)[0],
  }
  await service.callback({
    url: `/auth/callback?code=code_test&state=${authorization.state}`,
    headers: requestHeaders,
    socket: { encrypted: false },
  }, {
    writeHead(status, headers) { callbackResponse = { status, headers } },
    end() {},
  })
  assert.equal(callbackResponse.status, 302)
  assert.equal(callbackResponse.headers.location, 'http://172.20.5.172:3080/')

  let logoutResponse
  service.logout({
    headers: { cookie: callbackResponse.headers['set-cookie'][0].split(';', 1)[0] },
  }, {
    writeHead(status, headers) { logoutResponse = { status, headers } },
    end() {},
  })
  assert.equal(
    logoutResponse.headers.location,
    'https://auth.example/logout?return_to=http%3A%2F%2F172.20.5.172%3A3080%2F',
  )
  assert.equal(service.requestRedirectUri({
    headers: {
      host: '127.0.0.1:3080',
      'x-forwarded-host': 'dsh.example.com',
      'x-forwarded-proto': 'https',
    },
  }), 'https://dsh.example.com/auth/callback')
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

test('successful callback preserves the new session cookie', async () => {
  const sessions = new WorkOSAuthSessionStore({
    cookieSecret: 'd'.repeat(32),
    secureCookies: false,
  })
  const { state, setCookie } = sessions.createState()
  const service = Object.create(WorkOSAuthService.prototype)
  service.sessions = sessions
  service.config = {
    organizationId: 'org_acme',
    redirectUri: 'http://127.0.0.1:3080/auth/callback',
  }
  service.client = {
    userManagement: {
      authenticateWithCode: async () => ({
        user: {
          id: 'user_alice',
          name: 'Alice Example',
          email: 'alice@example.com',
        },
        organizationId: 'org_acme',
        accessToken: `header.${Buffer.from(JSON.stringify({ sid: 'session_workos' })).toString('base64url')}.signature`,
      }),
      getLogoutUrl: ({ sessionId, returnTo }) =>
        `https://auth.example/logout?session=${sessionId}&return_to=${encodeURIComponent(returnTo)}`,
    },
    organizations: {
      getOrganization: async id => ({ id, name: 'Acme Corporation' }),
    },
  }
  service.ctx = {
    connection: {
      authenticatedUrl: url => url,
    },
  }

  let response
  const res = {
    writeHead(status, headers) {
      response = { status, headers }
    },
    end() {},
  }
  await service.callback({
    url: `/auth/callback?code=code_test&state=${state}`,
    headers: { cookie: setCookie.split(';', 1)[0] },
  }, res)

  assert.equal(response.status, 302)
  assert.equal(response.headers.location, 'http://127.0.0.1:3080/')
  assert.equal(response.headers['set-cookie'].length, 2)
  assert.match(response.headers['set-cookie'][0], /^dsh-workos-session=/)
  assert.match(response.headers['set-cookie'][1], /^dsh-workos-state=.*Max-Age=0/)
  assert.deepEqual(sessions.identityFromHeaders({
    cookie: response.headers['set-cookie'][0].split(';', 1)[0],
  }), {
    organizationId: 'org_acme',
    userId: 'user_alice',
    role: 'member',
  })

  const authenticatedHeaders = {
    cookie: response.headers['set-cookie'][0].split(';', 1)[0],
  }
  assert.deepEqual(sessions.accountFromHeaders(authenticatedHeaders), {
    user: {
      id: 'user_alice',
      name: 'Alice Example',
      email: 'alice@example.com',
    },
    organization: {
      id: 'org_acme',
      name: 'Acme Corporation',
    },
  })

  let meResponse
  service.me({ headers: authenticatedHeaders }, {
    writeHead(status, headers) { meResponse = { status, headers } },
    end(body) { meResponse.body = JSON.parse(body) },
  })
  assert.equal(meResponse.status, 200)
  assert.deepEqual(meResponse.body, {
    identity: {
      organizationId: 'org_acme',
      userId: 'user_alice',
      role: 'member',
    },
    user: {
      id: 'user_alice',
      name: 'Alice Example',
      email: 'alice@example.com',
    },
    organization: {
      id: 'org_acme',
      name: 'Acme Corporation',
    },
    branding: {
      logoUrl: '/auth/branding/logo.png',
      name: 'RetailHarness',
    },
  })

  let logoResponse
  service.brandingLogo({ method: 'GET' }, {
    writeHead(status, headers) { logoResponse = { status, headers } },
    end(body) { logoResponse.body = body },
  })
  assert.equal(logoResponse.status, 200)
  assert.equal(logoResponse.headers['content-type'], 'image/png')
  assert.ok(Buffer.isBuffer(logoResponse.body))
  assert.ok(logoResponse.body.length > 1000)

  let logoutResponse
  service.logout({ headers: authenticatedHeaders }, {
    writeHead(status, headers) { logoutResponse = { status, headers } },
    end() {},
  })
  assert.equal(logoutResponse.status, 302)
  assert.equal(
    logoutResponse.headers.location,
    'https://auth.example/logout?session=session_workos&return_to=http%3A%2F%2F127.0.0.1%3A3080%2F',
  )
  assert.equal(logoutResponse.headers['set-cookie'].length, 2)
  assert.equal(sessions.identityFromHeaders(authenticatedHeaders), undefined)
})

test('account profile falls back to email parts and organization id', () => {
  assert.deepEqual(accountFromAuthentication({
    user: {
      id: 'user_alice',
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Example',
    },
  }, {
    organizationId: 'org_acme',
    userId: 'user_alice',
    role: 'member',
  }), {
    user: {
      id: 'user_alice',
      name: 'Alice Example',
      email: 'alice@example.com',
    },
    organization: {
      id: 'org_acme',
      name: 'org_acme',
    },
  })
})

test('tenant settings are admin-only and redact secrets', async () => {
  const sessions = new WorkOSAuthSessionStore({
    cookieSecret: 'e'.repeat(32),
    secureCookies: false,
  })
  const admin = sessions.createSession({ organizationId: 'org_acme', userId: 'user_admin', role: 'admin' })
  const member = sessions.createSession({ organizationId: 'org_acme', userId: 'user_member', role: 'member' })
  const effectiveConfig = {
    adminRoles: ['owner', 'admin'],
    adminCanManageKeys: false,
    workos: {
      clientId: 'client_acme',
      organizationId: 'org_acme',
      redirectUri: 'http://127.0.0.1:3080/auth/callback',
      sessionMaxAgeSeconds: 604800,
      secureCookies: false,
      apiKey: 'sk_secret',
      cookieSecret: 'c'.repeat(32),
    },
    storage: {
      mode: 'local',
      filePath: '/tmp/tenant-state.json',
      encryptionKey: 'f'.repeat(32),
      d1: {},
    },
  }
  let saved
  let policyUpdate
  const service = Object.create(WorkOSAuthService.prototype)
  service.sessions = sessions
  service.management = {
    effectiveConfig,
    store: { save: config => { saved = config } },
  }
  service.ctx = {
    get: () => ({ updateAccessPolicy: config => { policyUpdate = config } }),
    logger: { warn() {} },
  }

  const call = async (cookie, method = 'GET', body) => {
    let response
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    request.method = method
    request.headers = {
      cookie: cookie.split(';', 1)[0],
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    }
    await service.tenantSettings(request, {
      writeHead(status, headers) { response = { status, headers } },
      end(value) { response.body = value ? JSON.parse(value) : undefined },
    })
    return response
  }

  const memberResponse = await call(member.setCookie)
  assert.equal(memberResponse.status, 403)
  const getResponse = await call(admin.setCookie)
  assert.equal(getResponse.status, 200)
  assert.deepEqual(getResponse.body.config.policy, {
    adminRoles: ['owner', 'admin'],
    adminCanManageKeys: false,
  })
  assert.equal(getResponse.body.config.workos.apiKeyConfigured, true)
  assert.equal('apiKey' in getResponse.body.config.workos, false)

  const putResponse = await call(admin.setCookie, 'PUT', {
    policy: { adminRoles: [], adminCanManageKeys: false },
    workos: {
      clientId: 'client_acme',
      organizationId: 'org_acme',
      redirectUri: 'http://127.0.0.1:3080/auth/callback',
      sessionMaxAgeSeconds: 604800,
      secureCookies: false,
    },
    storage: { mode: 'local', filePath: '/tmp/tenant-state.json', d1: {} },
  })
  assert.equal(putResponse.status, 200)
  assert.deepEqual(saved.adminRoles, [])
  assert.deepEqual(policyUpdate.adminRoles, [])
  assert.equal(saved.workos.apiKey, 'sk_secret')
})

test('legacy recovery requires an administrator, matching origin, and the current user confirmation', async () => {
  const service = Object.create(WorkOSAuthService.prototype)
  service.sessions = new WorkOSAuthSessionStore({cookieSecret:'l'.repeat(32)})
  service.config = {redirectUri:'http://127.0.0.1:3080/auth/callback'}
  const admin = service.sessions.createSession({organizationId:'org_test',userId:'original-owner',role:'owner'})
  const member = service.sessions.createSession({organizationId:'org_test',userId:'member',role:'member'})
  const calls=[]
  service.ctx = {get:()=>({runtimeGuardsInstalled:true,legacyResources:async (identity,adopt)=> {
    calls.push({identity,adopt}); return {sessions:2,workspaces:1}
  }})}
  const invoke=async (session,origin,confirmedUserId,method='POST')=> {
    const req=Readable.from([Buffer.from(JSON.stringify({confirmedUserId}))])
    req.method=method
    req.headers={cookie:session.setCookie.split(';')[0],host:'127.0.0.1:3080',origin,'content-type':'application/json'}
    let response
    await service.legacyResources(req,{writeHead(status){response={status}},end(value){response.body=JSON.parse(value)}})
    return response
  }
  assert.equal((await invoke(member,'http://127.0.0.1:3080','member')).status,403)
  assert.equal((await invoke(admin,'https://other.test','original-owner')).status,403)
  assert.equal((await invoke(admin,'http://127.0.0.1:3080','another-user')).status,400)
  assert.equal(calls.length,0)
  assert.equal((await invoke(admin,undefined,undefined,'GET')).status,200)
  assert.equal(calls[0].adopt,false)
  assert.equal((await invoke(admin,'http://127.0.0.1:3080','original-owner')).status,200)
  assert.equal(calls[1].identity.userId,'original-owner')
  assert.equal(calls[1].adopt,true)
})
