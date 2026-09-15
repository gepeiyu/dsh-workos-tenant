import { AsyncLocalStorage } from 'node:async_hooks'
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import { normalizeIdentity } from './policy.js'
import {
  normalizeManagedTenantConfig,
  publicManagedTenantConfig,
  TenantConfigError,
} from './config.js'
import { isConfigurationAdmin } from './model-scope.js'

const DEFAULT_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
const STATE_MAX_AGE_SECONDS = 10 * 60
const COOKIE_NAME = 'dsh-workos-session'
const STATE_COOKIE_NAME = 'dsh-workos-state'

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

function headerValue(headers, name) {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return typeof value === 'string' ? value : undefined
}

export function parseCookies(headers) {
  const value = headerValue(headers, 'cookie')
  if (!value) return new Map()
  return new Map(value.split(';').flatMap(part => {
    const separator = part.indexOf('=')
    if (separator < 1) return []
    const name = part.slice(0, separator).trim()
    const raw = part.slice(separator + 1).trim()
    try {
      return [[name, decodeURIComponent(raw)]]
    } catch {
      return []
    }
  }))
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function signedValue(value, secret) {
  return `${value}.${sign(value, secret)}`
}

function verifySignedValue(value, secret) {
  const separator = value.lastIndexOf('.')
  if (separator < 1) return undefined
  const payload = value.slice(0, separator)
  const received = value.slice(separator + 1)
  const expected = sign(payload, secret)
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  if (receivedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(receivedBytes, expectedBytes)) return undefined
  return payload
}

function cookie(name, value, options = {}) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${options.sameSite ?? 'Lax'}`,
  ]
  if (options.maxAge !== undefined) attributes.push(`Max-Age=${options.maxAge}`)
  if (options.secure) attributes.push('Secure')
  return attributes.join('; ')
}

function clearCookie(name, secure) {
  return cookie(name, '', { maxAge: 0, secure })
}

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(body)
}

async function readJson(req, maxBytes = 64 * 1024) {
  const contentType = headerValue(req.headers, 'content-type')?.split(';', 1)[0]?.trim()
  if (contentType !== 'application/json') throw new TenantConfigError('Content-Type must be application/json', 415)
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > maxBytes) throw new TenantConfigError('Configuration body is too large', 413)
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new TenantConfigError('Configuration body must be valid JSON')
  }
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, 'cache-control': 'no-store', ...headers })
  res.end()
}

function identityFromAuthentication(result) {
  const user = result?.user ?? result?.profile
  const organizationId = result?.organizationId ?? result?.organization?.id
  const userId = user?.id ?? result?.userId
  const role = result?.role ?? user?.role ?? 'member'
  if (!organizationId || !userId) {
    throw new Error('WorkOS authentication did not return a user and organization')
  }
  return normalizeIdentity({ organizationId, userId, role })
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function accountFromAuthentication(result, identity, organization) {
  const user = result?.user ?? result?.profile ?? {}
  const fallbackName = [user.firstName, user.lastName]
    .map(stringValue)
    .filter(Boolean)
    .join(' ')
  const name = stringValue(user.name) ?? stringValue(fallbackName)
  return {
    user: {
      id: identity.userId,
      name,
      email: stringValue(user.email),
    },
    organization: {
      id: identity.organizationId,
      name: stringValue(organization?.name) ?? identity.organizationId,
    },
  }
}

function workosSessionIdFromAuthentication(result) {
  const accessToken = result?.accessToken
  if (typeof accessToken !== 'string') return undefined
  const payload = accessToken.split('.')[1]
  if (!payload) return undefined
  try {
    return stringValue(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.sid)
  } catch {
    return undefined
  }
}

export class WorkOSAuthSessionStore {
  constructor({
    cookieSecret,
    cookieName = COOKIE_NAME,
    stateCookieName = STATE_COOKIE_NAME,
    secureCookies = process.env.NODE_ENV === 'production',
    sessionMaxAgeSeconds = DEFAULT_SESSION_MAX_AGE_SECONDS,
  } = {}) {
    if (typeof cookieSecret !== 'string' || cookieSecret.length < 32) {
      throw new TypeError('WorkOS cookieSecret must contain at least 32 characters')
    }
    this.cookieSecret = cookieSecret
    this.cookieName = cookieName
    this.stateCookieName = stateCookieName
    this.secureCookies = secureCookies
    this.sessionMaxAgeSeconds = sessionMaxAgeSeconds
    this.sessions = new Map()
    this.states = new Map()
  }

  createState(redirectUri) {
    const state = randomToken()
    this.states.set(state, {
      expiresAt: Date.now() + STATE_MAX_AGE_SECONDS * 1000,
      redirectUri: stringValue(redirectUri),
    })
    return {
      state,
      setCookie: cookie(this.stateCookieName, state, {
        maxAge: STATE_MAX_AGE_SECONDS,
        secure: this.secureCookies,
      }),
    }
  }

  consumeState(state, requestHeaders, redirectUri) {
    const cookieState = parseCookies(requestHeaders).get(this.stateCookieName)
    const record = this.states.get(state)
    this.states.delete(state)
    const expiresAt = typeof record === 'number' ? record : record?.expiresAt
    const expectedRedirectUri = typeof record === 'object' ? record?.redirectUri : undefined
    if (!state || !cookieState || cookieState !== state || !expiresAt || expiresAt < Date.now() ||
        (expectedRedirectUri && expectedRedirectUri !== redirectUri)) {
      return false
    }
    return true
  }

  createSession(identity, account, workosSessionId, returnTo) {
    const sessionId = randomToken()
    this.sessions.set(sessionId, {
      identity: normalizeIdentity(identity),
      account: account ?? accountFromAuthentication({}, normalizeIdentity(identity)),
      workosSessionId: stringValue(workosSessionId),
      returnTo: stringValue(returnTo),
      expiresAt: Date.now() + this.sessionMaxAgeSeconds * 1000,
    })
    return {
      sessionId,
      setCookie: cookie(this.cookieName, signedValue(sessionId, this.cookieSecret), {
        maxAge: this.sessionMaxAgeSeconds,
        secure: this.secureCookies,
      }),
    }
  }

  destroyFromHeaders(headers) {
    const sessionId = this.sessionIdFromHeaders(headers)
    if (sessionId) this.sessions.delete(sessionId)
  }

  sessionIdFromHeaders(headers) {
    const value = parseCookies(headers).get(this.cookieName)
    if (!value) return undefined
    const sessionId = verifySignedValue(value, this.cookieSecret)
    if (!sessionId) return undefined
    const record = this.sessions.get(sessionId)
    if (!record || record.expiresAt < Date.now()) {
      this.sessions.delete(sessionId)
      return undefined
    }
    return sessionId
  }

  identityFromHeaders(headers) {
    return this.sessionFromHeaders(headers)?.identity
  }

  accountFromHeaders(headers) {
    return this.sessionFromHeaders(headers)?.account
  }

  sessionFromHeaders(headers) {
    const sessionId = this.sessionIdFromHeaders(headers)
    return sessionId ? this.sessions.get(sessionId) : undefined
  }

  clearCookies() {
    return [
      clearCookie(this.cookieName, this.secureCookies),
      this.clearStateCookie(),
    ]
  }

  clearStateCookie() {
    return clearCookie(this.stateCookieName, this.secureCookies)
  }
}

export function resolveWorkOSConfig(config = {}, options = {}) {
  const env = options.environment ?? process.env
  const preferConfig = options.preferConfig ?? false
  const pick = (configured, environment) => preferConfig
    ? configured ?? environment
    : environment ?? configured
  const resolved = {
    ...config,
    apiKey: pick(config.apiKey, env.WORKOS_API_KEY),
    clientId: pick(config.clientId, env.WORKOS_CLIENT_ID),
    organizationId: pick(config.organizationId, env.WORKOS_ORGANIZATION_ID),
    redirectUri: pick(config.redirectUri, env.WORKOS_REDIRECT_URI),
    cookieSecret: pick(config.cookieSecret, env.WORKOS_COOKIE_SECRET),
  }
  if (resolved.enabled === undefined) {
    resolved.enabled = Boolean(
      resolved.apiKey && resolved.clientId && resolved.organizationId &&
      resolved.redirectUri && resolved.cookieSecret,
    )
  }
  return resolved
}

async function createWorkOSClient(apiKey) {
  const { WorkOS } = await import('@workos-inc/node')
  return new WorkOS(apiKey)
}

export class WorkOSAuthService extends Service {
  static inject = ['webServer', 'connection']

  constructor(ctx, config = {}) {
    super(ctx, 'workosAuth')
    this.config = resolveWorkOSConfig(config, { preferConfig: Boolean(config.management) })
    this.sessions = new WorkOSAuthSessionStore(this.config)
    this.identityContext = new AsyncLocalStorage()
    this.client = config.client
    this.management = config.management
  }

  async [Service.init]() {
    if (!this.client) this.client = await createWorkOSClient(this.config.apiKey)
    const webServer = this.ctx.webServer
    // Cordis exposes the same service through several traceable context views.
    // Patch each view plus its concrete target so existing DSH route owners and
    // later plugin registrations observe the WorkOS gate.
    const connectionView = this.ctx.get('connection')
    const connection = connectionView?.[Symbol.for('cordis.original')] ?? connectionView
    const contextConnection = this.ctx.connection
    const patches = []
    const authService = this
    const connectionPrototype = connection && Object.getPrototypeOf(connection)
    if (connectionPrototype && connectionPrototype !== Object.prototype) {
      const originalPrototypeRequestRejection = connectionPrototype.requestRejection
      const originalPrototypeAuthorizeIndex = connectionPrototype.authorizeIndex
      if (typeof originalPrototypeRequestRejection === 'function' &&
          typeof originalPrototypeAuthorizeIndex === 'function') {
        connectionPrototype.requestRejection = function (request) {
          const rejection = originalPrototypeRequestRejection.call(this, request)
          if (rejection !== undefined) return rejection
          const identity = authService.identityFromRequest(request)
          if (!identity) return 401
          authService.bindRequestIdentity(request, identity)
          return undefined
        }
        connectionPrototype.authorizeIndex = function (request, response) {
          if (!authService.identityFromRequest(request)) {
            redirect(response, '/auth/login')
            return false
          }
          return originalPrototypeAuthorizeIndex.call(this, request, response)
        }
        patches.push(() => {
          connectionPrototype.requestRejection = originalPrototypeRequestRejection
          connectionPrototype.authorizeIndex = originalPrototypeAuthorizeIndex
        })
      }
    }
    const connectionViews = [...new Set([connection, connectionView, contextConnection])]
    for (const view of connectionViews) {
      if (!view || typeof view.requestRejection !== 'function' ||
          typeof view.authorizeIndex !== 'function') continue
      const originalRequestRejection = view.requestRejection.bind(view)
      const originalAuthorizeIndex = view.authorizeIndex.bind(view)
      const originalRequest = view.requestRejection
      const originalIndex = view.authorizeIndex
      view.requestRejection = request => {
        const rejection = originalRequestRejection(request)
        if (rejection !== undefined) return rejection
        const identity = this.identityFromRequest(request)
        if (!identity) return 401
        this.bindRequestIdentity(request, identity)
        return undefined
      }
      view.authorizeIndex = (request, response) => {
        if (!this.identityFromRequest(request)) {
          redirect(response, '/auth/login')
          return false
        }
        return originalAuthorizeIndex(request, response)
      }
      patches.push(() => {
        view.requestRejection = originalRequest
        view.authorizeIndex = originalIndex
      })
    }

    const register = route => this.ctx.effect(
      () => webServer.register(route),
      `workos-auth: ${route.path}`,
    )

    register({
      kind: 'exact',
      path: '/auth/login',
      handler: (req, res) => this.login(req, res),
    })
    register({
      kind: 'exact',
      path: '/auth/callback',
      handler: (req, res) => this.callback(req, res),
    })
    register({
      kind: 'exact',
      path: '/auth/logout',
      handler: (req, res) => this.logout(req, res),
    })
    register({
      kind: 'exact',
      path: '/auth/me',
      handler: (req, res) => this.me(req, res),
    })
    if (this.management) register({
      kind: 'exact',
      path: '/auth/tenant-settings',
      handler: (req, res) => this.tenantSettings(req, res),
    })
    register({ kind: 'exact', path: '/auth/resources', handler: (req, res) => this.resources(req, res) })
    register({ kind: 'exact', path: '/auth/legacy-resources', handler: (req, res) => this.legacyResources(req, res) })

    this.ctx.effect(() => () => {
      for (const restore of patches.reverse()) restore()
      for (const [socket, original] of this.identitySockets ?? []) socket.emit = original
      this.identitySockets?.clear()
    }, 'workos-auth: restore connection guards')
  }

  identityFromRequest(request) {
    return this.sessions.identityFromHeaders(request?.headers)
  }

  requireIdentity(request) {
    const identity = this.identityFromRequest(request)
    if (!identity) {
      const error = new Error('WorkOS authentication is required')
      error.code = 'AUTH_REQUIRED'
      error.status = 401
      throw error
    }
    return identity
  }

  currentIdentity() {
    return this.identityContext.getStore()
  }

  bindRequestIdentity(request, identity) {
    this.identityContext.enterWith(identity)
    const socket = request.socket
    if (request.headers?.upgrade?.toLowerCase() !== 'websocket' || !socket) return
    this.identitySockets ??= new Map()
    if (this.identitySockets.has(socket)) return
    const original = socket.emit
    const auth = this
    this.identitySockets.set(socket, original)
    // Socket callbacks otherwise run in the server's original async context,
    // rather than the authenticated HTTP upgrade's context.
    socket.emit = function (...args) {
      return auth.identityContext.run(auth.identityFromRequest(request), () => original.apply(this, args))
    }
    socket.once('close', () => { this.identitySockets.delete(socket) })
  }

  async resources(req, res) {
    const identity = this.identityFromRequest(req)
    if (!identity) return json(res, 401, { error: 'AUTH_REQUIRED' })
    if (req.method !== 'GET') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    const tenant = this.ctx.get('tenantPolicy')
    if (!tenant?.runtimeGuardsInstalled) return json(res, 503, { error: 'TENANT_POLICY_NOT_READY' })
    const sessions = []
    for (const record of tenant.listOwnedSessions(identity)) {
      if (await tenant.canAccessSessionLocation(identity, record.id)) sessions.push(record.id)
    }
    const workspaces = tenant.listOwnedWorkspaces(identity)
      .filter(record => tenant.canAccessWorkspaceLocation(identity, record.id))
      .map(record => record.id)
    return json(res, 200, {
      identity,
      sessions,
      workspaces,
    })
  }

  async legacyResources(req, res) {
    const identity = this.identityFromRequest(req)
    if (!identity) return json(res, 401, { error: 'AUTH_REQUIRED' })
    if (!isConfigurationAdmin(identity)) return json(res, 403, { error: 'ADMIN_REQUIRED' })
    if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    try {
      if (req.method === 'POST') {
        const origin = req.headers.origin
        const expected = new URL(this.requestRedirectUri(req)).origin
        if (origin !== expected) return json(res, 403, { error: 'ORIGIN_FORBIDDEN' })
        const body = await readJson(req)
        if (body.confirmedUserId !== identity.userId) return json(res, 400, { error: 'OWNER_CONFIRMATION_REQUIRED' })
      }
      const tenant = this.ctx.get('tenantPolicy')
      if (!tenant?.runtimeGuardsInstalled) return json(res, 503, { error: 'TENANT_POLICY_NOT_READY' })
      return json(res, 200, await tenant.legacyResources(identity, req.method === 'POST'))
    } catch (error) {
      return json(res, error.status ?? 500, { error: error.code ?? 'LEGACY_MIGRATION_FAILED' })
    }
  }

  runWithRequestIdentity(request, callback) {
    return this.identityContext.run(this.requireIdentity(request), callback)
  }

  async identityForAuthentication(result) {
    let role = result?.role
    const userId = result?.user?.id ?? result?.userId
    if (!role && userId && this.client?.userManagement?.listOrganizationMemberships) {
      try {
        const page = await this.client.userManagement.listOrganizationMemberships({
          organizationId: this.config.organizationId,
          userId,
          statuses: ['active'],
        })
        const membership = page?.data?.[0]
        role = membership?.role?.slug ?? membership?.role?.name ?? membership?.role?.id
      } catch {
        // A missing membership-list permission must fail closed as a member.
        role = 'member'
      }
    }
    return identityFromAuthentication({ ...result, role: role ?? 'member' })
  }

  async accountForAuthentication(result, identity) {
    let organization = result?.organization
    if (!stringValue(organization?.name) && this.client?.organizations?.getOrganization) {
      try {
        organization = await this.client.organizations.getOrganization(identity.organizationId)
      } catch (error) {
        this.ctx.logger?.warn?.(`WorkOS organization lookup failed: ${error.message}`)
      }
    }
    return accountFromAuthentication(result, identity, organization)
  }

  requestRedirectUri(req) {
    const configured = new URL(this.config.redirectUri)
    if (this.management?.effectiveConfig?.network?.allowNetworkAccess !== true) {
      return configured.toString()
    }

    const forwardedHost = headerValue(req?.headers, 'x-forwarded-host')?.split(',', 1)[0]?.trim()
    const host = forwardedHost ?? headerValue(req?.headers, 'host')?.trim()
    if (!host) return configured.toString()

    const forwardedProtocol = headerValue(req?.headers, 'x-forwarded-proto')
      ?.split(',', 1)[0]?.trim().toLowerCase()
    const protocol = forwardedProtocol === 'http' || forwardedProtocol === 'https'
      ? `${forwardedProtocol}:`
      : req?.socket
        ? (req.socket.encrypted ? 'https:' : 'http:')
        : configured.protocol
    try {
      const origin = new URL(`${protocol}//${host}`).origin
      return new URL(configured.pathname, `${origin}/`).toString()
    } catch {
      return configured.toString()
    }
  }

  async login(req, res) {
    const redirectUri = this.requestRedirectUri(req)
    const { state, setCookie } = this.sessions.createState(redirectUri)
    const result = await this.client.userManagement.getAuthorizationUrl({
      provider: 'authkit',
      clientId: this.config.clientId,
      organizationId: this.config.organizationId,
      redirectUri,
      state,
    })
    const location = typeof result === 'string' ? result : result.url
    if (!location) throw new Error('WorkOS did not return an authorization URL')
    redirect(res, location, { 'set-cookie': setCookie })
  }

  async callback(req, res) {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const redirectUri = this.requestRedirectUri(req)
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (error) return json(res, 401, { error: 'WORKOS_AUTH_FAILED', detail: error })
    if (!code || !this.sessions.consumeState(state, req.headers, redirectUri)) {
      return json(res, 400, { error: 'WORKOS_CALLBACK_INVALID' })
    }

    const result = await this.client.userManagement.authenticateWithCode({
      code,
      clientId: this.config.clientId,
    })
    const identity = await this.identityForAuthentication(result)
    if (identity.organizationId !== this.config.organizationId) {
      return json(res, 403, { error: 'WORKOS_ORGANIZATION_FORBIDDEN' })
    }
    const account = await this.accountForAuthentication(result, identity)
    const session = this.sessions.createSession(
      identity,
      account,
      workosSessionIdFromAuthentication(result),
      `${new URL(redirectUri).origin}/`,
    )
    const origin = new URL(redirectUri).origin
    const dshUrl = this.ctx.connection.authenticatedUrl(`${origin}/`)
    return redirect(res, dshUrl, {
      'set-cookie': [session.setCookie, this.sessions.clearStateCookie()],
    })
  }

  logout(req, res) {
    const session = this.sessions.sessionFromHeaders(req.headers)
    this.sessions.destroyFromHeaders(req.headers)
    let location = '/auth/login'
    if (session?.workosSessionId && this.client?.userManagement?.getLogoutUrl) {
      try {
        const origin = new URL(this.config.redirectUri).origin
        location = this.client.userManagement.getLogoutUrl({
          sessionId: session.workosSessionId,
          returnTo: session.returnTo ?? `${origin}/`,
        })
      } catch (error) {
        this.ctx.logger?.warn?.(`WorkOS logout URL creation failed: ${error.message}`)
      }
    }
    return redirect(res, location, { 'set-cookie': this.sessions.clearCookies() })
  }

  me(req, res) {
    const session = this.sessions.sessionFromHeaders(req.headers)
    if (!session) return json(res, 401, { error: 'AUTH_REQUIRED' })
    const branding = publicManagedTenantConfig(this.management?.effectiveConfig ?? {}).branding
    const hasBranding = Boolean(branding?.logoUrl || branding?.name)
    return json(res, 200, {
      identity: session.identity,
      user: session.account.user,
      organization: session.account.organization,
      ...(hasBranding ? { branding } : {}),
    })
  }

  async tenantSettings(req, res) {
    const identity = this.identityFromRequest(req)
    if (!identity) return json(res, 401, { error: 'AUTH_REQUIRED' })
    if (!isConfigurationAdmin(identity)) {
      return json(res, 403, { error: 'ADMIN_REQUIRED' })
    }
    if (req.method === 'GET') {
      return json(res, 200, {
        config: publicManagedTenantConfig(this.management.effectiveConfig),
        applies: {
          policy: 'live',
          workos: 'restart',
          storage: 'restart',
        },
      })
    }
    if (req.method !== 'PUT') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' }, { allow: 'GET, PUT' })

    try {
      const body = await readJson(req)
      const next = normalizeManagedTenantConfig(body, this.management.effectiveConfig)
      this.management.store.save(next)
      this.management.effectiveConfig = next
      const tenantPolicy = this.ctx.get('tenantPolicy', false)
      tenantPolicy?.updateAccessPolicy?.(next)
      return json(res, 200, {
        config: publicManagedTenantConfig(next),
        restartRequired: true,
      })
    } catch (error) {
      const status = error instanceof TenantConfigError ? error.status : 500
      this.ctx.logger?.warn?.(`Tenant configuration update failed: ${error.message}`)
      return json(res, status, {
        error: error.code ?? 'TENANT_CONFIG_UPDATE_FAILED',
        detail: error.message,
      })
    }
  }
}

export { accountFromAuthentication, identityFromAuthentication }
