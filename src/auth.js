import { AsyncLocalStorage } from 'node:async_hooks'
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import { normalizeIdentity } from './policy.js'

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

  createState() {
    const state = randomToken()
    this.states.set(state, Date.now() + STATE_MAX_AGE_SECONDS * 1000)
    return {
      state,
      setCookie: cookie(this.stateCookieName, state, {
        maxAge: STATE_MAX_AGE_SECONDS,
        secure: this.secureCookies,
      }),
    }
  }

  consumeState(state, requestHeaders) {
    const cookieState = parseCookies(requestHeaders).get(this.stateCookieName)
    const expiresAt = this.states.get(state)
    this.states.delete(state)
    if (!state || !cookieState || cookieState !== state || !expiresAt || expiresAt < Date.now()) {
      return false
    }
    return true
  }

  createSession(identity) {
    const sessionId = randomToken()
    this.sessions.set(sessionId, {
      identity: normalizeIdentity(identity),
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
    const sessionId = this.sessionIdFromHeaders(headers)
    return sessionId ? this.sessions.get(sessionId)?.identity : undefined
  }

  clearCookies() {
    return [
      clearCookie(this.cookieName, this.secureCookies),
      clearCookie(this.stateCookieName, this.secureCookies),
    ]
  }
}

export function resolveWorkOSConfig(config = {}) {
  const resolved = {
    ...config,
    apiKey: process.env.WORKOS_API_KEY ?? config.apiKey,
    clientId: process.env.WORKOS_CLIENT_ID ?? config.clientId,
    organizationId: process.env.WORKOS_ORGANIZATION_ID ?? config.organizationId,
    redirectUri: process.env.WORKOS_REDIRECT_URI ?? config.redirectUri,
    cookieSecret: process.env.WORKOS_COOKIE_SECRET ?? config.cookieSecret,
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
    this.config = resolveWorkOSConfig(config)
    this.sessions = new WorkOSAuthSessionStore(this.config)
    this.identityContext = new AsyncLocalStorage()
    this.client = config.client
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
          authService.identityContext.enterWith(identity)
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
        this.identityContext.enterWith(identity)
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
      handler: (_req, res) => this.login(res),
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

    this.ctx.effect(() => {
      for (const restore of patches.reverse()) restore()
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

  async login(res) {
    const { state, setCookie } = this.sessions.createState()
    const result = await this.client.userManagement.getAuthorizationUrl({
      provider: 'authkit',
      clientId: this.config.clientId,
      organizationId: this.config.organizationId,
      redirectUri: this.config.redirectUri,
      state,
    })
    const location = typeof result === 'string' ? result : result.url
    if (!location) throw new Error('WorkOS did not return an authorization URL')
    redirect(res, location, { 'set-cookie': setCookie })
  }

  async callback(req, res) {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (error) return json(res, 401, { error: 'WORKOS_AUTH_FAILED', detail: error })
    if (!code || !this.sessions.consumeState(state, req.headers)) {
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
    const session = this.sessions.createSession(identity)
    const origin = new URL(this.config.redirectUri).origin
    const dshUrl = this.ctx.connection.authenticatedUrl(`${origin}/`)
    return redirect(res, dshUrl, {
      'set-cookie': [session.setCookie, ...this.sessions.clearCookies()],
    })
  }

  logout(req, res) {
    this.sessions.destroyFromHeaders(req.headers)
    return redirect(res, '/auth/login', { 'set-cookie': this.sessions.clearCookies() })
  }

  me(req, res) {
    const identity = this.sessions.identityFromHeaders(req.headers)
    if (!identity) return json(res, 401, { error: 'AUTH_REQUIRED' })
    return json(res, 200, { identity })
  }
}

export { identityFromAuthentication }
