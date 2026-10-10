import { useEffect, useState } from 'react'
import {
  Button,
  IconChevronUpOutlineRegular,
  IconUserOutlineRegular,
  Menu,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { installSessionVisibility } from './visibility.js'
import { dictionaries } from './locales.js'
import { BrandingSettings, installBranding } from './branding.jsx'

const NS = 'workos.account'

const styles = `
.dsh-workos-account { min-width: 0; width: 100%; }
.dsh-workos-account__menu { display: flex; width: 100%; }
.dsh-workos-account__menu-list {
  min-width: 224px !important;
  padding: 8px !important;
}
.dsh-workos-account__menu-list [role="menuitem"] {
  min-height: 38px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 20px;
}
.dsh-workos-account__menu-list > [role="presentation"] > [role="presentation"] {
  padding: 7px 10px;
  font-size: 12px;
  line-height: 18px;
}
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
let accountState = 'loading'
const accountListeners = new Set()

function notifyAccountListeners() {
  for (const listener of accountListeners) listener()
}

function setAccountState(value) {
  if (accountState === value) return
  accountState = value
  notifyAccountListeners()
}

function loadAccount({ force = false } = {}) {
  if (accountSnapshot) return Promise.resolve(accountSnapshot)
  if (force) accountRequest = undefined
  accountRequest ??= fetch('/auth/me', {
    credentials: 'same-origin',
    cache: 'no-store',
  }).then(async response => {
    if (response.ok) return response.json()
    setAccountState(response.status === 404 ? 'local' : response.status === 401 || response.status === 403 ? 'signed-out' : 'error')
    return undefined
  })
    .then(value => {
      if (value?.user && value?.organization) {
        accountSnapshot = value
        setAccountState('signed-in')
      }
      return accountSnapshot
    })
    .catch(error => {
      console.error('[dsh-workos-tenant] account lookup failed', error)
      setAccountState('error')
      return undefined
    })
    .finally(() => { accountRequest = undefined })
  return accountRequest
}

function displayAccount(account) {
  const primary = account.user.name || account.user.email || account.user.id
  const organization = account.organization.name || account.organization.id
  return { primary, organization }
}

function useAccount() {
  const [value, setValue] = useState(() => ({ account: accountSnapshot, status: accountState }))
  useEffect(() => {
    let active = true
    let attempts = 0
    let retryTimer
    const update = () => {
      void loadAccount({ force: attempts > 0 }).then(value => {
        if (!active) return
        setValue({ account: value, status: accountState })
        if (!value && attempts < 5) {
          attempts += 1
          retryTimer = window.setTimeout(update, 1200)
        }
      })
    }
    const wake = () => {
      attempts = 0
      update()
    }
    const onSnapshot = () => { if (active) setValue({ account: accountSnapshot, status: accountState }) }
    accountListeners.add(onSnapshot)
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    update()
    return () => {
      active = false
      accountListeners.delete(onSnapshot)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    }
  }, [])
  return value
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
  const { account, status } = useAccount()
  const [open, setOpen] = useState(false)
  if (!account) {
    const primary = status === 'loading'
      ? t('loadingAccount')
      : status === 'local'
        ? t('localMode')
        : status === 'signed-out'
          ? t('signedOut')
          : t('accountUnavailable')
    const canSignIn = status === 'signed-out'
    const button = (
      <button
        type="button"
        className="dsh-workos-account__button dsh-workos-account__button--status"
        aria-label={canSignIn ? t('signIn') : primary}
        disabled={!canSignIn}
        onClick={() => { if (canSignIn) window.location.assign('/auth/login') }}
      >
          <span className="dsh-workos-account__avatar" aria-hidden="true"><IconUserOutlineRegular size={wide ? 14 : 18} /></span>
        {wide && <span className="dsh-workos-account__copy"><span className="dsh-workos-account__primary">{primary}</span>{canSignIn && <span className="dsh-workos-account__secondary">{t('signIn')}</span>}</span>}
      </button>
    )
    return <div className={`dsh-workos-account${wide ? '' : ' dsh-workos-account--rail'}`} data-dsh-workos-account="">{button}</div>
  }

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
        <IconUserOutlineRegular size={wide ? 14 : 18} />
      </span>
      {wide && (
        <span className="dsh-workos-account__copy">
          <span className="dsh-workos-account__primary">{primary}</span>
          <span className="dsh-workos-account__secondary">{organization}</span>
        </span>
      )}
      {wide && <IconChevronUpOutlineRegular className="dsh-workos-account__chevron" />}
    </button>
  )

  return (
    <div
      className={`dsh-workos-account${wide ? '' : ' dsh-workos-account--rail'}`}
      data-dsh-workos-account=""
    >
      <Menu
        className="dsh-workos-account__menu"
        listClassName="dsh-workos-account__menu-list"
        open={open}
        side="top"
        align={wide ? 'end' : 'start'}
        portal
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
  ctx.effect(() => installSettingsVisibility(ctx), 'workos-account: settings visibility')
  ctx.effect(() => installBranding(ctx), 'workos-account: branding')
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'workos-account: dictionaries')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'workos-account',
    order: 100,
    locale: NS,
  }, AccountAction))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'workos-tenant',
    order: 60,
    label: () => ctx.locale.bind(NS)('tenantTab'),
    locale: NS,
  }, TenantSettingsTab))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'workos-branding',
    order: 70,
    label: () => ctx.locale.bind(NS)('branding'),
    locale: NS,
  }, () => <BrandingSettings t={ctx.locale.bind(NS)} />))
}
