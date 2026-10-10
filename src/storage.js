import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { DEFAULT_BRANDING, RUNNING_ICONS } from './branding.js'

const STATE_VERSION = 1
const DEFAULT_ROW_ID = 'tenant-policy'
const PLATFORM_BRANDING_ID = 'platform'
// Keep both images comfortably below D1's 1 MB row limit when stored together.
const MAX_BRANDING_IMAGE_BYTES = 380_000

export class TenantStorageError extends Error {
  constructor(message, options = {}) {
    super(message, options)
    this.name = 'TenantStorageError'
  }
}

function brandingText(value, label, max) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > max) {
    throw new TenantStorageError(`${label} must be a string of at most ${max} characters`)
  }
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(value)) {
    throw new TenantStorageError(`${label} must be a browser image data URL`)
  }
  return value
}

function optionalBrandingText(value, label) {
  if (value != null && typeof value !== 'string') {
    throw new TenantStorageError(`${label} must be a string`)
  }
  return value?.trim() || null
}

export function normalizeBranding(value = {}) {
  const badge = typeof value.badge === 'string' && value.badge.trim()
    ? value.badge.trim().slice(0, 30)
    : DEFAULT_BRANDING.badge
  const logo = brandingText(value.logo, 'logo', MAX_BRANDING_IMAGE_BYTES)
  const wordmark = brandingText(value.wordmark, 'wordmark', MAX_BRANDING_IMAGE_BYTES)
  const runningIcon = value.runningIcon ?? DEFAULT_BRANDING.runningIcon
  if (!RUNNING_ICONS.includes(runningIcon)) {
    throw new TenantStorageError('runningIcon must be whale, spinner, or dots')
  }
  const runningText = optionalBrandingText(value.runningText, 'runningText')
  const heroHeadline = optionalBrandingText(value.heroHeadline, 'heroHeadline')
  const heroBadgeText = optionalBrandingText(value.heroBadgeText, 'heroBadgeText')
  const heroBadgeVisible = value.heroBadgeVisible ?? DEFAULT_BRANDING.heroBadgeVisible
  if (typeof heroBadgeVisible !== 'boolean') {
    throw new TenantStorageError('heroBadgeVisible must be a boolean')
  }
  return { badge, logo, wordmark, runningIcon, runningText, heroHeadline, heroBadgeText, heroBadgeVisible }
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
    this.brandingFilePath = resolve(options.brandingFilePath ?? process.env.DSH_TENANT_BRANDING_FILE ??
      `${this.filePath}.branding`)
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

  async loadBranding() {
    try {
      const raw = readFileSync(this.brandingFilePath, 'utf8')
      return normalizeBranding(JSON.parse(open(raw, this.encryptionKey)))
    } catch (error) {
      if (error?.code === 'ENOENT') return normalizeBranding()
      if (error instanceof TenantStorageError) throw error
      throw new TenantStorageError(`Could not read local tenant branding: ${error.message}`, { cause: error })
    }
  }

  saveBranding(branding) {
    const payload = seal(JSON.stringify(normalizeBranding(branding)), this.encryptionKey)
    mkdirSync(dirname(this.brandingFilePath), { recursive: true })
    writeFileSync(this.brandingFilePath, payload, { mode: 0o600 })
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

  async ensureBrandingTable() {
    if (this.brandingTableReady) return this.brandingTableReady
    this.brandingTableReady = this.initializeBrandingTable().catch(error => {
      this.brandingTableReady = undefined
      throw error
    })
    return this.brandingTableReady
  }

  async initializeBrandingTable() {
    await this.query(`CREATE TABLE IF NOT EXISTS dsh_tenant_branding (
      scope_id TEXT PRIMARY KEY,
      badge TEXT NOT NULL,
      logo TEXT,
      wordmark TEXT,
      running_icon TEXT NOT NULL DEFAULT 'whale',
      running_text TEXT,
      hero_headline TEXT,
      hero_badge_text TEXT,
      hero_badge_visible INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    )`)
    const columns = await this.query('PRAGMA table_info(dsh_tenant_branding)')
    for (const [name, definition] of [
      ['running_icon', "TEXT NOT NULL DEFAULT 'whale'"],
      ['running_text', 'TEXT'],
      ['hero_headline', 'TEXT'],
      ['hero_badge_text', 'TEXT'],
      ['hero_badge_visible', 'INTEGER NOT NULL DEFAULT 1'],
    ]) {
      if (columns.some(column => column.name === name)) continue
      try {
        await this.query(`ALTER TABLE dsh_tenant_branding ADD COLUMN ${name} ${definition}`)
      } catch (error) {
        // Another server may have migrated this shared database concurrently.
        const current = await this.query('PRAGMA table_info(dsh_tenant_branding)')
        if (!current.some(column => column.name === name)) throw error
      }
    }
  }

  async loadBranding() {
    await this.ensureBrandingTable()
    const rows = await this.query(
      `SELECT badge, logo, wordmark, running_icon AS runningIcon, running_text AS runningText,
       hero_headline AS heroHeadline, hero_badge_text AS heroBadgeText, hero_badge_visible AS heroBadgeVisible
       FROM dsh_tenant_branding WHERE scope_id = ?`,
      [PLATFORM_BRANDING_ID],
    )
    const row = rows[0]
    return normalizeBranding(row ? { ...row, heroBadgeVisible: row.heroBadgeVisible == null ? undefined : Boolean(row.heroBadgeVisible) } : DEFAULT_BRANDING)
  }

  saveBranding(branding) {
    const value = normalizeBranding(branding)
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await this.ensureBrandingTable()
      await this.query(
        `INSERT INTO dsh_tenant_branding (scope_id, badge, logo, wordmark, running_icon, running_text, hero_headline, hero_badge_text, hero_badge_visible, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_id) DO UPDATE SET
           badge = excluded.badge,
           logo = excluded.logo,
           wordmark = excluded.wordmark,
           running_icon = excluded.running_icon,
           running_text = excluded.running_text,
           hero_headline = excluded.hero_headline,
           hero_badge_text = excluded.hero_badge_text,
           hero_badge_visible = excluded.hero_badge_visible,
           updated_at = excluded.updated_at`,
        [PLATFORM_BRANDING_ID, value.badge, value.logo, value.wordmark, value.runningIcon, value.runningText,
          value.heroHeadline, value.heroBadgeText, value.heroBadgeVisible ? 1 : 0, new Date().toISOString()],
      )
    })
    return this.writeQueue
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
