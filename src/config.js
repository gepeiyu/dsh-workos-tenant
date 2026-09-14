import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

const CONFIG_VERSION = 1

export class TenantConfigError extends Error {
  constructor(message, status = 400, options = {}) {
    super(message, options)
    this.name = 'TenantConfigError'
    this.code = 'TENANT_CONFIG_INVALID'
    this.status = status
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeObjects(base, override) {
  const result = isRecord(base) ? { ...base } : {}
  if (!isRecord(override)) return result
  for (const [key, value] of Object.entries(override)) {
    result[key] = isRecord(value) ? mergeObjects(result[key], value) : value
  }
  return result
}

export function mergeTenantConfig(base = {}, managed = {}) {
  return mergeObjects(base, managed)
}

function requiredString(value, label, { min = 1, max = 2048 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new TenantConfigError(`${label} must contain ${min}-${max} characters`)
  }
  return value.trim()
}

function optionalString(value, label, max = 4096) {
  if (value === undefined || value === null || value === '') return undefined
  return requiredString(value, label, { max })
}

function requiredBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TenantConfigError(`${label} must be a boolean`)
  return value
}

function requiredInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TenantConfigError(`${label} must be an integer between ${min} and ${max}`)
  }
  return value
}

function requiredUrl(value, label) {
  const text = requiredString(value, label)
  let url
  try {
    url = new URL(text)
  } catch {
    throw new TenantConfigError(`${label} must be a valid URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TenantConfigError(`${label} must use http or https`)
  }
  return url.toString()
}

function secret(input, fallback, label, min = 1) {
  if (input === undefined || input === null || input === '') {
    return optionalString(fallback, label, 8192)
  }
  return requiredString(input, label, { min, max: 8192 })
}

function uniqueRoles(value) {
  if (!Array.isArray(value) || value.length > 16) {
    throw new TenantConfigError('adminRoles must be an array with at most 16 roles')
  }
  return [...new Set(value.map(role => requiredString(role, 'admin role', { max: 64 })))]
}

export function normalizeManagedTenantConfig(input, fallback = {}) {
  if (!isRecord(input)) throw new TenantConfigError('Configuration body must be an object')
  const policy = input.policy
  const workos = input.workos
  const storage = input.storage
  const network = input.network ?? {}
  const workspace = input.workspace ?? {}
  if (!isRecord(policy) || !isRecord(workos) || !isRecord(storage) || !isRecord(network) || !isRecord(workspace)) {
    throw new TenantConfigError('policy, workos, storage, network, and workspace sections must be objects')
  }

  const mode = requiredString(storage.mode, 'storage mode', { max: 16 })
  if (mode !== 'local' && mode !== 'd1') {
    throw new TenantConfigError('storage mode must be local or d1')
  }

  const normalized = {
    adminRoles: uniqueRoles(policy.adminRoles),
    adminCanManageKeys: requiredBoolean(policy.adminCanManageKeys, 'adminCanManageKeys'),
    network: {
      allowNetworkAccess: network.allowNetworkAccess === undefined
        ? Boolean(fallback.network?.allowNetworkAccess)
        : requiredBoolean(network.allowNetworkAccess, 'allowNetworkAccess'),
    },
    workspace: {
      root: workspace.root === undefined
        ? optionalString(fallback.workspace?.root, 'workspace root')
        : optionalString(workspace.root, 'workspace root'),
    },
    workos: {
      clientId: requiredString(workos.clientId, 'WorkOS client ID'),
      organizationId: requiredString(workos.organizationId, 'WorkOS organization ID'),
      redirectUri: requiredUrl(workos.redirectUri, 'WorkOS redirect URI'),
      sessionMaxAgeSeconds: requiredInteger(
        workos.sessionMaxAgeSeconds,
        'sessionMaxAgeSeconds',
        300,
        31_536_000,
      ),
      secureCookies: requiredBoolean(workos.secureCookies, 'secureCookies'),
      apiKey: secret(workos.apiKey, fallback.workos?.apiKey, 'WorkOS API key'),
      cookieSecret: secret(workos.cookieSecret, fallback.workos?.cookieSecret, 'cookie secret', 32),
    },
    storage: {
      mode,
      filePath: optionalString(storage.filePath, 'local state path'),
      encryptionKey: secret(
        storage.encryptionKey,
        fallback.storage?.encryptionKey,
        'tenant encryption key',
        16,
      ),
      d1: {
        accountId: optionalString(storage.d1?.accountId, 'Cloudflare account ID'),
        databaseId: optionalString(storage.d1?.databaseId, 'Cloudflare D1 database ID'),
        apiBaseUrl: storage.d1?.apiBaseUrl
          ? requiredUrl(storage.d1.apiBaseUrl, 'Cloudflare API base URL')
          : undefined,
        apiToken: secret(
          storage.d1?.apiToken,
          fallback.storage?.d1?.apiToken,
          'Cloudflare API token',
        ),
      },
    },
  }

  if (!normalized.workos.apiKey || !normalized.workos.cookieSecret) {
    throw new TenantConfigError('WorkOS API key and cookie secret must be configured')
  }
  if (normalized.workspace.root && !isAbsolute(normalized.workspace.root)) {
    throw new TenantConfigError('workspace root must be an absolute path')
  }
  if (mode === 'd1') {
    if (!normalized.storage.d1.accountId || !normalized.storage.d1.databaseId ||
        !normalized.storage.d1.apiToken || !normalized.storage.encryptionKey) {
      throw new TenantConfigError(
        'D1 mode requires account ID, database ID, API token, and tenant encryption key',
      )
    }
  }
  return normalized
}

export function publicManagedTenantConfig(config) {
  return {
    policy: {
      adminRoles: [...(config.adminRoles ?? [])],
      adminCanManageKeys: Boolean(config.adminCanManageKeys),
    },
    network: {
      allowNetworkAccess: Boolean(config.network?.allowNetworkAccess),
    },
    workspace: {
      root: config.workspace?.root ?? '',
    },
    workos: {
      clientId: config.workos?.clientId ?? '',
      organizationId: config.workos?.organizationId ?? '',
      redirectUri: config.workos?.redirectUri ?? '',
      sessionMaxAgeSeconds: config.workos?.sessionMaxAgeSeconds ?? 7 * 24 * 60 * 60,
      secureCookies: config.workos?.secureCookies ?? process.env.NODE_ENV === 'production',
      apiKeyConfigured: Boolean(config.workos?.apiKey),
      cookieSecretConfigured: Boolean(config.workos?.cookieSecret),
    },
    storage: {
      mode: config.storage?.mode ?? 'local',
      filePath: config.storage?.filePath ?? '',
      encryptionKeyConfigured: Boolean(config.storage?.encryptionKey),
      d1: {
        accountId: config.storage?.d1?.accountId ?? '',
        databaseId: config.storage?.d1?.databaseId ?? '',
        apiBaseUrl: config.storage?.d1?.apiBaseUrl ?? 'https://api.cloudflare.com/client/v4',
        apiTokenConfigured: Boolean(config.storage?.d1?.apiToken),
      },
    },
  }
}

function encryptedPayload(value, key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return JSON.stringify({
    version: CONFIG_VERSION,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: ciphertext.toString('base64url'),
  })
}

function decryptedPayload(raw, key) {
  const envelope = JSON.parse(raw)
  if (envelope?.version !== CONFIG_VERSION) throw new TenantConfigError('Unsupported config version', 500)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
  return JSON.parse(plaintext)
}

export class ManagedTenantConfigStore {
  constructor(options = {}) {
    const home = process.env.DSH_HOME ?? process.cwd()
    this.filePath = resolve(options.filePath ?? process.env.DSH_TENANT_CONFIG_FILE ??
      resolve(home, 'workos-tenant-config.json'))
    this.keyPath = resolve(options.keyPath ?? process.env.DSH_TENANT_CONFIG_KEY_FILE ??
      `${this.filePath}.key`)
  }

  readKey(create = false) {
    try {
      const key = Buffer.from(readFileSync(this.keyPath, 'utf8').trim(), 'base64url')
      if (key.length !== 32) throw new TenantConfigError('Managed config key is invalid', 500)
      return key
    } catch (error) {
      if (error?.code !== 'ENOENT' || !create) throw error
      const key = randomBytes(32)
      mkdirSync(dirname(this.keyPath), { recursive: true })
      writeFileSync(this.keyPath, key.toString('base64url'), { mode: 0o600, flag: 'wx' })
      return key
    }
  }

  load() {
    try {
      return decryptedPayload(readFileSync(this.filePath, 'utf8'), this.readKey())
    } catch (error) {
      if (error?.code === 'ENOENT') return {}
      if (error instanceof TenantConfigError) throw error
      throw new TenantConfigError(`Could not read managed configuration: ${error.message}`, 500, {
        cause: error,
      })
    }
  }

  save(config) {
    const key = this.readKey(true)
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, encryptedPayload(config, key), { mode: 0o600 })
    chmodSync(this.filePath, 0o600)
  }
}
