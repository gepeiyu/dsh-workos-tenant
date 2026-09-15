import { useEffect, useState } from 'react'
import {
  Button,
  IconChevronUpOutline14,
  IconUserOutline16,
  Menu,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { installSessionVisibility } from './visibility.js'

const NS = 'workos.account'

const zh = {
  accountMenu: '账户菜单',
  logout: '退出登录',
  signedInAs: '当前用户',
  organization: '组织',
  role: '角色',
  tenantTab: 'WorkOS 租户',
  tenantTitle: 'WorkOS 租户配置',
  tenantIntro: '管理登录、品牌、网络访问、工作区路径和租户状态存储。连接或存储变更将在重启 DSH 后生效。',
  branding: '品牌设置',
  logoUrl: 'Logo 地址',
  logoUrlHint: '可填写 HTTPS 图片地址或同源根路径；同时用于侧栏、新会话和浏览器标签图标。',
  brandName: '品牌名称',
  brandNameHint: '留空时使用 DSH 默认品牌名称。',
  network: '网络访问',
  allowNetworkAccess: '允许同一网络中的其他设备访问 DSH',
  allowNetworkAccessHint: '开启后 DSH 会监听所有网卡。保存后需要重启 DSH，并确认防火墙只允许可信网络。',
  workspaceScope: '工作区路径隔离',
  workspaceRoot: '工作区根目录',
  workspaceRootHint: '可留空保持现有路径。设置绝对路径后，每位用户只能使用“根目录/组织 ID/用户 ID”下的目录；保存后立即生效。',
  workosConnection: 'WorkOS 连接',
  clientId: 'Client ID',
  organizationId: 'Organization ID',
  redirectUri: '回调地址',
  redirectUriHint: '默认用于本机登录。开启网络访问后会自动改为当前访问主机；请在 WorkOS 中登记每个完整回调地址及对应退出地址。production 环境请使用 HTTPS 域名。',
  apiKey: 'API Key',
  cookieSecret: 'Cookie Secret',
  sessionMaxAge: '登录有效期（秒）',
  secureCookies: '仅通过 HTTPS 发送登录 Cookie',
  storage: '租户状态存储',
  storageMode: '存储方式',
  local: '本地文件',
  d1: 'Cloudflare D1',
  statePath: '本地状态文件',
  encryptionKey: '状态加密密钥',
  accountId: 'Cloudflare Account ID',
  databaseId: 'D1 Database ID',
  apiBaseUrl: 'Cloudflare API 地址',
  apiToken: 'Cloudflare API Token',
  secretConfigured: '已配置；留空保持不变',
  secretMissing: '尚未配置',
  save: '保存配置',
  saving: '正在保存…',
  saved: '配置已保存。请重启 DSH 以应用连接或存储变更。',
  loading: '正在加载配置…',
  loadFailed: '无法加载租户配置。',
  retry: '重试',
}

const en = {
  accountMenu: 'Account menu',
  logout: 'Sign out',
  signedInAs: 'Signed in as',
  organization: 'Organization',
  role: 'Role',
  tenantTab: 'WorkOS tenant',
  tenantTitle: 'WorkOS tenant configuration',
  tenantIntro: 'Manage sign-in, branding, network access, workspace paths, and tenant-state storage. Connection and storage changes apply after restarting DSH.',
  branding: 'Branding',
  logoUrl: 'Logo URL',
  logoUrlHint: 'Use an HTTPS image URL or a same-origin root path. It is used in the sidebar, New Session view, and browser tab icon.',
  brandName: 'Brand name',
  brandNameHint: 'Leave blank to use the default RetailHarness name.',
  network: 'Network access',
  allowNetworkAccess: 'Allow other devices on the network to access DSH',
  allowNetworkAccessHint: 'DSH will listen on all network interfaces. Restart DSH after saving and restrict access with your firewall.',
  workspaceScope: 'Workspace path isolation',
  workspaceRoot: 'Workspace root',
  workspaceRootHint: 'Leave blank to preserve existing paths. When set to an absolute path, each user is restricted to root/organization ID/user ID. Applies immediately.',
  workosConnection: 'WorkOS connection',
  clientId: 'Client ID',
  organizationId: 'Organization ID',
  redirectUri: 'Redirect URI',
  redirectUriHint: 'Used as the local default. With network access enabled, the current host is used automatically; register every callback and matching sign-out URL in WorkOS. Use an HTTPS domain in production.',
  apiKey: 'API key',
  cookieSecret: 'Cookie secret',
  sessionMaxAge: 'Session lifetime (seconds)',
  secureCookies: 'Send the sign-in cookie over HTTPS only',
  storage: 'Tenant-state storage',
  storageMode: 'Storage mode',
  local: 'Local file',
  d1: 'Cloudflare D1',
  statePath: 'Local state file',
  encryptionKey: 'State encryption key',
  accountId: 'Cloudflare Account ID',
  databaseId: 'D1 Database ID',
  apiBaseUrl: 'Cloudflare API URL',
  apiToken: 'Cloudflare API token',
  secretConfigured: 'Configured; leave blank to keep it',
  secretMissing: 'Not configured',
  save: 'Save configuration',
  saving: 'Saving…',
  saved: 'Configuration saved. Restart DSH to apply connection or storage changes.',
  loading: 'Loading configuration…',
  loadFailed: 'Could not load tenant configuration.',
  retry: 'Retry',
}

const styles = `
.dsh-workos-account { min-width: 0; width: 100%; }
.dsh-workos-account__menu { display: flex; width: 100%; }
.dsh-workos-account__button {
  box-sizing: border-box;
  width: calc(100% + 4px);
  height: 42px;
  margin: 4px -2px;
  padding: 0 8px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  text-align: left;
  overflow: hidden;
}
.dsh-workos-account__button:hover,
.dsh-workos-account__button[data-open] {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-workos-account__avatar {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-interactive-bg-active);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dsh-workos-account__copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.dsh-workos-account__primary,
.dsh-workos-account__secondary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0;
}
.dsh-workos-account__primary { font-size: 13px; line-height: 17px; }
.dsh-workos-account__secondary {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 15px;
}
.dsh-workos-account__chevron {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 150ms var(--ds-ease-in-out);
}
.dsh-workos-account__button[data-open] .dsh-workos-account__chevron {
  transform: rotate(180deg);
}
.dsh-workos-account--rail { width: 36px; }
.dsh-workos-account--rail .dsh-workos-account__button {
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  justify-content: center;
  border-radius: 50%;
}
.dsh-workos-account--rail .dsh-workos-account__avatar {
  width: 36px;
  height: 36px;
  background: transparent;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-workos-account__chevron { transition: none; }
}
.dsh-workos-settings { color: var(--dsw-alias-label-primary); max-width: 700px; }
.dsh-workos-settings__header { margin-bottom: 20px; }
.dsh-workos-settings__title { margin: 0 0 5px; font-size: 17px; line-height: 24px; letter-spacing: 0; }
.dsh-workos-settings__intro,
.dsh-workos-settings__hint,
.dsh-workos-settings__secret-state,
.dsh-workos-settings__status { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dsh-workos-settings__intro { margin: 0; }
.dsh-workos-settings__group { border-top: 1px solid var(--dsw-alias-border-l2); padding: 18px 0 20px; }
.dsh-workos-settings__group-title { margin: 0 0 14px; font-size: 14px; line-height: 20px; letter-spacing: 0; }
.dsh-workos-settings__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; }
.dsh-workos-settings__field { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.dsh-workos-settings__field--wide { grid-column: 1 / -1; }
.dsh-workos-settings__label { font-size: 12px; font-weight: 500; line-height: 18px; }
.dsh-workos-settings__input,
.dsh-workos-settings__select {
  box-sizing: border-box; width: 100%; height: 34px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; letter-spacing: 0;
}
.dsh-workos-settings__input:focus,
.dsh-workos-settings__select:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.dsh-workos-settings__check { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 19px; }
.dsh-workos-settings__check input { margin: 3px 0 0; }
.dsh-workos-settings__actions { border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 16px; display: flex; align-items: center; gap: 12px; }
.dsh-workos-settings__error { color: var(--dsw-alias-label-error); font-size: 12px; line-height: 18px; }
@media (max-width: 680px) {
  .dsh-workos-settings__grid { grid-template-columns: minmax(0, 1fr); }
  .dsh-workos-settings__field--wide { grid-column: auto; }
  html[data-dsh-workos-member] [role="dialog"]:has(> nav) > nav { display: none; }
  html[data-dsh-workos-member] [role="dialog"]:has(> nav) > div {
    width: 100%;
    min-width: 0;
    flex: 1 1 auto;
  }
}
html[data-dsh-workos-member] [role="dialog"]:has(> nav) > div > :first-child > :not(:last-child) {
  display: none;
}
`

let accountSnapshot
let accountRequest
const accountListeners = new Set()
const BRANDING_LINK_SELECTOR = 'link[data-dsh-workos-branding="favicon"]'
const DEFAULT_BRAND_LOGO_URL = '/auth/branding/logo.png'
const DEFAULT_BRAND_NAME = 'RetailHarness'

function applyBrandingFavicon(branding) {
  const current = document.head.querySelector(BRANDING_LINK_SELECTOR)
  if (!branding?.logoUrl) {
    current?.remove()
    return
  }
  const link = current ?? document.createElement('link')
  link.rel = 'icon'
  link.dataset.dshWorkosBranding = 'favicon'
  link.href = branding.logoUrl
  if (!current) document.head.appendChild(link)
}

function loadAccount() {
  if (accountSnapshot) return Promise.resolve(accountSnapshot)
  accountRequest ??= fetch('/auth/me', {
    credentials: 'same-origin',
    cache: 'no-store',
  }).then(async response => response.ok ? response.json() : undefined)
    .then(value => {
      if (value?.user && value?.organization) {
        accountSnapshot = value
        applyBrandingFavicon(value.branding)
        for (const listener of accountListeners) listener()
      }
      return accountSnapshot
    })
    .catch(error => {
      console.error('[dsh-workos-tenant] account lookup failed', error)
      return undefined
    })
  return accountRequest
}

function displayAccount(account) {
  const primary = account.user.name || account.user.email || account.user.id
  const organization = account.organization.name || account.organization.id
  return { primary, organization }
}

function useAccount() {
  const [account, setAccount] = useState(accountSnapshot)
  useEffect(() => {
    let active = true
    const update = () => { if (active) setAccount(accountSnapshot) }
    accountListeners.add(update)
    void loadAccount().then(value => { if (active) setAccount(value) })
    return () => {
      active = false
      accountListeners.delete(update)
    }
  }, [])
  return account
}

function BrandMark({ size, className }) {
  const account = useAccount()
  const logoUrl = account?.branding?.logoUrl || DEFAULT_BRAND_LOGO_URL
  return <img src={logoUrl} alt="" width={size} height={size} className={className} style={{ objectFit: 'contain', display: 'block' }} />
}

function BrandName() {
  const account = useAccount()
  const name = account?.branding?.name || DEFAULT_BRAND_NAME
  return <span>{name}</span>
}

function installBrandSlots(ctx) {
  const disposers = [
    ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register(
      { name: 'dsh-workos-brand-mark', priority: -100 }, BrandMark,
    )),
    ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register(
      { name: 'dsh-workos-brand-name', priority: -100 }, BrandName,
    )),
    ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register(
      { name: 'dsh-workos-hero-brand-mark', priority: -100 }, BrandMark,
    )),
  ]
  return () => { for (const dispose of disposers) dispose() }
}

function isAdmin(account) {
  return account?.identity?.role === 'owner' || account?.identity?.role === 'admin'
}

function installSettingsVisibility(ctx) {
  const slots = ctx.slots
  const entries = slots.entries.bind(slots)
  const entriesOfSlot = slots.entriesOfSlot.bind(slots)
  const getVersion = slots.getVersion.bind(slots)
  const subscribe = slots.subscribe.bind(slots)
  const guardedSlots = new Set(['settings.section', 'settings.action', 'settings.onboarding'])
  let visibilityRevision = 0
  const filterEntries = (name, rows) => {
    if (!accountSnapshot || isAdmin(accountSnapshot)) return rows
    if (name === 'settings.section') {
      return rows.filter(entry => entry.options.id === 'models')
    }
    if (name === 'settings.action') return []
    if (name === 'settings.onboarding') {
      return rows.filter(entry => entry.options.id === 'deepseek-official')
    }
    return rows
  }
  const syncVisibility = () => {
    visibilityRevision += 1
    if (accountSnapshot && !isAdmin(accountSnapshot)) {
      document.documentElement.dataset.dshWorkosMember = ''
    } else {
      delete document.documentElement.dataset.dshWorkosMember
    }
  }
  accountListeners.add(syncVisibility)
  slots.entries = name => filterEntries(name, entries(name))
  slots.entriesOfSlot = name => filterEntries(name, entriesOfSlot(name))
  slots.getVersion = name => getVersion(name) + (guardedSlots.has(name) ? visibilityRevision : 0)
  slots.subscribe = (name, listener) => {
    const dispose = subscribe(name, listener)
    if (!guardedSlots.has(name)) return dispose
    accountListeners.add(listener)
    return () => {
      accountListeners.delete(listener)
      dispose()
    }
  }
  syncVisibility()
  void loadAccount()
  return () => {
    accountListeners.delete(syncVisibility)
    delete document.documentElement.dataset.dshWorkosMember
    slots.entries = entries
    slots.entriesOfSlot = entriesOfSlot
    slots.getVersion = getVersion
    slots.subscribe = subscribe
  }
}

// DSH keeps Settings scopes in memory for non-loopback browsers and skips the
// describe/mutate RPCs entirely. WorkOS authentication provides the missing
// per-user boundary, so allow those scopes to use the authenticated API.
let remoteSettingsUnpinned = false

function unpinRemoteSettingsScopes() {
  if (remoteSettingsUnpinned) return
  try {
    const uiSettings = require('@deepseek-ai/dsh-client-ui-settings')
    const Controller = uiSettings?.SettingsScopeController
    if (typeof Controller?.prototype?.enqueue !== 'function') return
    Controller.prototype.enqueue = function (operation) {
      if (this.disposed) return Promise.resolve()
      const task = this.tail.then(async () => {
        if (this.disposed) return
        await operation()
      })
      this.tail = task.catch(() => {})
      return task
    }
    remoteSettingsUnpinned = true
  } catch {
    // Older DSH builds do not expose the controller; preserve their behavior.
  }
}

function Field({ label, hint, wide, children }) {
  return (
    <label className={`dsh-workos-settings__field${wide ? ' dsh-workos-settings__field--wide' : ''}`}>
      <span className="dsh-workos-settings__label">{label}</span>
      {children}
      {hint && <span className="dsh-workos-settings__hint">{hint}</span>}
    </label>
  )
}

function SecretField({ label, configured, value, onChange, t }) {
  return (
    <Field label={label} hint={configured ? t('secretConfigured') : t('secretMissing')}>
      <input
        className="dsh-workos-settings__input"
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={event => { onChange(event.target.value) }}
      />
    </Field>
  )
}

function TenantSettingsTab({ t }) {
  const [draft, setDraft] = useState()
  const [secrets, setSecrets] = useState({ apiKey: '', cookieSecret: '', encryptionKey: '', apiToken: '' })
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState()

  const load = () => {
    setStatus('loading')
    setError(undefined)
    void fetch('/auth/tenant-settings', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        const value = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(value.detail || value.error || t('loadFailed'))
        setDraft(value.config)
        setStatus('ready')
      })
      .catch(reason => {
        setError(reason.message)
        setStatus('error')
      })
  }
  useEffect(load, [])

  const change = (path, value) => {
    setDraft(previous => {
      const next = structuredClone(previous)
      let target = next
      for (const segment of path.slice(0, -1)) target = target[segment]
      target[path.at(-1)] = value
      return next
    })
  }
  const save = event => {
    event.preventDefault()
    setStatus('saving')
    setError(undefined)
    const body = {
      policy: draft.policy,
      network: draft.network,
      workspace: draft.workspace,
      branding: draft.branding ?? {},
      workos: {
        ...draft.workos,
        apiKey: secrets.apiKey,
        cookieSecret: secrets.cookieSecret,
        apiKeyConfigured: undefined,
        cookieSecretConfigured: undefined,
      },
      storage: {
        ...draft.storage,
        encryptionKey: secrets.encryptionKey,
        encryptionKeyConfigured: undefined,
        d1: {
          ...draft.storage.d1,
          apiToken: secrets.apiToken,
          apiTokenConfigured: undefined,
        },
      },
    }
    void fetch('/auth/tenant-settings', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async response => {
      const value = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(value.detail || value.error || t('loadFailed'))
      setDraft(value.config)
      if (accountSnapshot) {
        accountSnapshot = { ...accountSnapshot, branding: value.config.branding }
        applyBrandingFavicon(value.config.branding)
        for (const listener of accountListeners) listener()
      }
      setSecrets({ apiKey: '', cookieSecret: '', encryptionKey: '', apiToken: '' })
      setStatus('saved')
    }).catch(reason => {
      setError(reason.message)
      setStatus('error')
    })
  }

  if (!draft) return (
    <div className="dsh-workos-settings">
      <p className={status === 'error' ? 'dsh-workos-settings__error' : 'dsh-workos-settings__status'}>
        {error || t('loading')}
      </p>
      {status === 'error' && <Button variant="outline" size="sm" onClick={load}>{t('retry')}</Button>}
    </div>
  )

  const d1 = draft.storage.mode === 'd1'
  return (
    <form className="dsh-workos-settings" onSubmit={save}>
      <header className="dsh-workos-settings__header">
        <h3 className="dsh-workos-settings__title">{t('tenantTitle')}</h3>
        <p className="dsh-workos-settings__intro">{t('tenantIntro')}</p>
      </header>
      <section className="dsh-workos-settings__group">
        <h4 className="dsh-workos-settings__group-title">{t('branding')}</h4>
        <div className="dsh-workos-settings__grid">
          <Field label={t('logoUrl')} hint={t('logoUrlHint')} wide>
            <input className="dsh-workos-settings__input" value={draft.branding?.logoUrl ?? ''} onChange={event => {
              change(['branding', 'logoUrl'], event.target.value)
            }} />
          </Field>
          <Field label={t('brandName')} hint={t('brandNameHint')} wide>
            <input className="dsh-workos-settings__input" value={draft.branding?.name ?? ''} onChange={event => {
              change(['branding', 'name'], event.target.value)
            }} />
          </Field>
        </div>
      </section>
      <section className="dsh-workos-settings__group">
        <h4 className="dsh-workos-settings__group-title">{t('workspaceScope')}</h4>
        <Field label={t('workspaceRoot')} hint={t('workspaceRootHint')} wide>
          <input className="dsh-workos-settings__input" value={draft.workspace?.root ?? ''} placeholder="/srv/dsh/workspaces" onChange={event => {
            change(['workspace', 'root'], event.target.value)
          }} />
        </Field>
      </section>
      <section className="dsh-workos-settings__group">
        <h4 className="dsh-workos-settings__group-title">{t('network')}</h4>
        <label className="dsh-workos-settings__check">
          <input type="checkbox" checked={Boolean(draft.network?.allowNetworkAccess)} onChange={event => {
            change(['network', 'allowNetworkAccess'], event.target.checked)
          }} />
          <span>
            {t('allowNetworkAccess')}
            <span className="dsh-workos-settings__hint">{t('allowNetworkAccessHint')}</span>
          </span>
        </label>
      </section>
      <section className="dsh-workos-settings__group">
        <h4 className="dsh-workos-settings__group-title">{t('workosConnection')}</h4>
        <div className="dsh-workos-settings__grid">
          <Field label={t('clientId')}><input className="dsh-workos-settings__input" value={draft.workos.clientId} onChange={event => { change(['workos', 'clientId'], event.target.value) }} /></Field>
          <Field label={t('organizationId')}><input className="dsh-workos-settings__input" value={draft.workos.organizationId} onChange={event => { change(['workos', 'organizationId'], event.target.value) }} /></Field>
          <Field label={t('redirectUri')} hint={t('redirectUriHint')} wide><input className="dsh-workos-settings__input" type="url" value={draft.workos.redirectUri} onChange={event => { change(['workos', 'redirectUri'], event.target.value) }} /></Field>
          <SecretField label={t('apiKey')} configured={draft.workos.apiKeyConfigured} value={secrets.apiKey} t={t} onChange={value => { setSecrets(current => ({ ...current, apiKey: value })) }} />
          <SecretField label={t('cookieSecret')} configured={draft.workos.cookieSecretConfigured} value={secrets.cookieSecret} t={t} onChange={value => { setSecrets(current => ({ ...current, cookieSecret: value })) }} />
          <Field label={t('sessionMaxAge')}><input className="dsh-workos-settings__input" type="number" min="300" max="31536000" value={draft.workos.sessionMaxAgeSeconds} onChange={event => { change(['workos', 'sessionMaxAgeSeconds'], Number(event.target.value)) }} /></Field>
          <label className="dsh-workos-settings__check">
            <input type="checkbox" checked={draft.workos.secureCookies} onChange={event => { change(['workos', 'secureCookies'], event.target.checked) }} />
            <span>{t('secureCookies')}</span>
          </label>
        </div>
      </section>
      <section className="dsh-workos-settings__group">
        <h4 className="dsh-workos-settings__group-title">{t('storage')}</h4>
        <div className="dsh-workos-settings__grid">
          <Field label={t('storageMode')}>
            <select className="dsh-workos-settings__select" value={draft.storage.mode} onChange={event => { change(['storage', 'mode'], event.target.value) }}>
              <option value="local">{t('local')}</option><option value="d1">{t('d1')}</option>
            </select>
          </Field>
          {!d1 && <Field label={t('statePath')}><input className="dsh-workos-settings__input" value={draft.storage.filePath} onChange={event => { change(['storage', 'filePath'], event.target.value) }} /></Field>}
          <SecretField label={t('encryptionKey')} configured={draft.storage.encryptionKeyConfigured} value={secrets.encryptionKey} t={t} onChange={value => { setSecrets(current => ({ ...current, encryptionKey: value })) }} />
          {d1 && <>
            <Field label={t('accountId')}><input className="dsh-workos-settings__input" value={draft.storage.d1.accountId} onChange={event => { change(['storage', 'd1', 'accountId'], event.target.value) }} /></Field>
            <Field label={t('databaseId')}><input className="dsh-workos-settings__input" value={draft.storage.d1.databaseId} onChange={event => { change(['storage', 'd1', 'databaseId'], event.target.value) }} /></Field>
            <Field label={t('apiBaseUrl')} wide><input className="dsh-workos-settings__input" type="url" value={draft.storage.d1.apiBaseUrl} onChange={event => { change(['storage', 'd1', 'apiBaseUrl'], event.target.value) }} /></Field>
            <SecretField label={t('apiToken')} configured={draft.storage.d1.apiTokenConfigured} value={secrets.apiToken} t={t} onChange={value => { setSecrets(current => ({ ...current, apiToken: value })) }} />
          </>}
        </div>
      </section>
      <div className="dsh-workos-settings__actions">
        <Button type="submit" variant="primary" size="sm" disabled={status === 'saving'}>{status === 'saving' ? t('saving') : t('save')}</Button>
        {status === 'saved' && <span className="dsh-workos-settings__status">{t('saved')}</span>}
        {error && <span className="dsh-workos-settings__error">{error}</span>}
      </div>
    </form>
  )
}

function AccountAction({ wide, t }) {
  const account = useAccount()
  const [open, setOpen] = useState(false)
  if (!account) return null

  const { primary, organization } = displayAccount(account)
  const label = `${primary}, ${organization}`
  const button = (
    <button
      type="button"
      className="dsh-workos-account__button"
      aria-label={`${t('accountMenu')}: ${label}`}
      aria-haspopup="menu"
      aria-expanded={open}
      data-open={open || undefined}
      onClick={() => { setOpen(value => !value) }}
    >
      <span className="dsh-workos-account__avatar" aria-hidden="true">
        <IconUserOutline16 size={wide ? 14 : 18} />
      </span>
      {wide && (
        <span className="dsh-workos-account__copy">
          <span className="dsh-workos-account__primary">{primary}</span>
          <span className="dsh-workos-account__secondary">{organization}</span>
        </span>
      )}
      {wide && <IconChevronUpOutline14 className="dsh-workos-account__chevron" />}
    </button>
  )

  return (
    <div
      className={`dsh-workos-account${wide ? '' : ' dsh-workos-account--rail'}`}
      data-dsh-workos-account=""
    >
      <Menu
        className="dsh-workos-account__menu"
        open={open}
        side="top"
        align={wide ? 'end' : 'start'}
        portal
        compact
        items={[
          { type: 'label', id: 'user', text: `${t('signedInAs')}: ${primary}` },
          { type: 'label', id: 'organization', text: `${t('organization')}: ${organization}` },
          { type: 'label', id: 'role', text: `${t('role')}: ${account.identity.role}` },
          { type: 'separator', id: 'account-separator' },
          { id: 'logout', label: t('logout'), danger: true },
        ]}
        onSelect={id => {
          if (id !== 'logout') return
          setOpen(false)
          window.location.assign('/auth/logout')
        }}
        onClose={() => { setOpen(false) }}
        anchor={wide ? button : (
          <Tooltip label={label} side="right" delayMs={500}>{button}</Tooltip>
        )}
      />
    </div>
  )
}

function installStyles() {
  const id = 'dsh-workos-tenant/account'
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(id)}]`)) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-workos-tenant'
  tag.dataset.pluginCss = id
  tag.textContent = styles
  document.head.appendChild(tag)
  return () => { tag.remove() }
}

export const inject = ['slots', 'locale', 'sessions']

export function apply(ctx) {
  unpinRemoteSettingsScopes()
  ctx.effect(() => installSessionVisibility(ctx), 'workos-account: session visibility')
  ctx.effect(installStyles, 'workos-account: styles')
  ctx.effect(() => installBrandSlots(ctx), 'workos-account: branding')
  ctx.effect(() => installSettingsVisibility(ctx), 'workos-account: settings visibility')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workos-account: dictionaries')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'workos-account',
    order: 100,
    locale: NS,
  }, AccountAction))
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'workos-tenant',
    order: 30,
    label: () => ctx.locale.bind(NS)('tenantTab'),
    locale: NS,
  }, TenantSettingsTab))
}
