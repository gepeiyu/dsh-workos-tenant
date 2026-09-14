import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const STATE_VERSION = 1
const DEFAULT_ROW_ID = 'tenant-policy'

export class TenantStorageError extends Error {
  constructor(message, options = {}) {
    super(message, options)
    this.name = 'TenantStorageError'
  }
}

function encryptionKey(value) {
  if (typeof value !== 'string' || value.length < 16) return undefined
  return createHash('sha256').update(value).digest()
}

function seal(value, secret) {
  const key = encryptionKey(secret)
  if (!key) return value
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':')
}

function open(value, secret) {
  const key = encryptionKey(secret)
  if (!key || !value.startsWith('v1:')) return value
  const [, ivText, tagText, ciphertextText] = value.split(':')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch (error) {
    throw new TenantStorageError('Tenant storage payload could not be decrypted', { cause: error })
  }
}

function normalizeState(state) {
  return {
    version: STATE_VERSION,
    sessions: Array.isArray(state?.sessions) ? state.sessions : [],
    workspaces: Array.isArray(state?.workspaces) ? state.workspaces : [],
    apiKeys: Array.isArray(state?.apiKeys) ? state.apiKeys : [],
  }
}

export class LocalTenantStorage {
  constructor(options = {}) {
    this.filePath = resolve(options.filePath ?? process.env.DSH_TENANT_STATE_FILE ??
      resolve(process.env.DSH_HOME ?? process.cwd(), 'tenant-state.json'))
    this.encryptionKey = options.encryptionKey ?? process.env.DSH_TENANT_ENCRYPTION_KEY
  }

  async load() {
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      return normalizeState(JSON.parse(open(raw, this.encryptionKey)))
    } catch (error) {
      if (error?.code === 'ENOENT') return normalizeState()
      if (error instanceof TenantStorageError) throw error
      throw new TenantStorageError(`Could not read local tenant storage: ${error.message}`, { cause: error })
    }
  }

  save(state) {
    const payload = seal(JSON.stringify(normalizeState(state)), this.encryptionKey)
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, payload, { mode: 0o600 })
  }
}

export class D1TenantStorage {
  constructor(options = {}) {
    this.accountId = options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID
    this.databaseId = options.databaseId ?? process.env.CLOUDFLARE_D1_DATABASE_ID
    this.apiToken = options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN
    this.apiBaseUrl = (options.apiBaseUrl ?? process.env.CLOUDFLARE_API_BASE_URL ??
      'https://api.cloudflare.com/client/v4').replace(/\/$/, '')
    this.encryptionKey = options.encryptionKey ?? process.env.DSH_TENANT_ENCRYPTION_KEY
    if (!this.accountId || !this.databaseId || !this.apiToken) {
      throw new TenantStorageError('D1 storage requires accountId, databaseId, and apiToken')
    }
    if (!encryptionKey(this.encryptionKey)) {
      throw new TenantStorageError('D1 storage requires DSH_TENANT_ENCRYPTION_KEY')
    }
    this.writeQueue = Promise.resolve()
  }

  get endpoint() {
    return `${this.apiBaseUrl}/accounts/${encodeURIComponent(this.accountId)}/d1/database/${encodeURIComponent(this.databaseId)}/query`
  }

  async query(sql, params = []) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    })
    const body = await response.json().catch(() => undefined)
    if (!response.ok || !body?.success) {
      throw new TenantStorageError(`Cloudflare D1 request failed (${response.status})`, {
        cause: body?.errors ?? body,
      })
    }
    return body.result?.[0]?.results ?? []
  }

  async ensureTable() {
    await this.query(`CREATE TABLE IF NOT EXISTS dsh_tenant_state (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
  }

  async load() {
    await this.ensureTable()
    const rows = await this.query('SELECT state FROM dsh_tenant_state WHERE id = ?', [DEFAULT_ROW_ID])
    if (rows.length === 0) return normalizeState()
    return normalizeState(JSON.parse(open(rows[0].state, this.encryptionKey)))
  }

  save(state) {
    const payload = seal(JSON.stringify(normalizeState(state)), this.encryptionKey)
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await this.ensureTable()
      await this.query(
        `INSERT INTO dsh_tenant_state (id, state, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
        [DEFAULT_ROW_ID, payload, new Date().toISOString()],
      )
    })
    return this.writeQueue
  }
}

export function resolveTenantStorageConfig(config = {}, options = {}) {
  const source = config ?? {}
  const d1 = source.d1 ?? {}
  const env = options.environment ?? process.env
  const preferConfig = options.preferConfig ?? false
  const pick = (configured, environment) => preferConfig
    ? configured ?? environment
    : environment ?? configured
  const mode = pick(source.mode, env.DSH_TENANT_STORAGE) ??
    (source.d1 || env.CLOUDFLARE_D1_DATABASE_ID ? 'd1' : 'local')
  return {
    mode,
    filePath: pick(source.filePath, env.DSH_TENANT_STATE_FILE),
    encryptionKey: pick(source.encryptionKey, env.DSH_TENANT_ENCRYPTION_KEY),
    d1: {
      accountId: pick(d1.accountId, env.CLOUDFLARE_ACCOUNT_ID),
      databaseId: pick(d1.databaseId, env.CLOUDFLARE_D1_DATABASE_ID),
      apiToken: pick(d1.apiToken, env.CLOUDFLARE_API_TOKEN),
      apiBaseUrl: pick(d1.apiBaseUrl, env.CLOUDFLARE_API_BASE_URL),
      encryptionKey: pick(d1.encryptionKey, env.DSH_TENANT_ENCRYPTION_KEY),
    },
  }
}

export function createTenantStorage(config = {}, options = {}) {
  const resolved = resolveTenantStorageConfig(config, options)
  if (resolved.mode === 'local') return new LocalTenantStorage(resolved)
  if (resolved.mode === 'd1') return new D1TenantStorage({
    ...resolved.d1,
    encryptionKey: resolved.d1.encryptionKey ?? resolved.encryptionKey,
  })
  throw new TenantStorageError(`Unknown tenant storage mode: ${resolved.mode}`)
}
