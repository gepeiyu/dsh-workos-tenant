import { useEffect, useState } from 'react'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '@deepseek-ai/dsh-client-ui-primitives'
import { DEFAULT_BRANDING, RUNNING_ICONS } from '../branding.js'
import { installRunningStatus, runningStatusStyles } from './running-status.js'
import { installHeroLogo } from './hero-branding.js'

const LEGACY_BRAND_SELECTOR = 'svg[viewBox="0 0 182 24"]'
const BRAND_NAME_SELECTOR = 'svg[viewBox="26 0 156 24"]'
const BRAND_MARK_SELECTOR = 'svg[viewBox="0 0 23.16 17.04"]'
const BADGE_TEXT_SELECTOR = 'g[clip-path*="badge"]'
const WHALE_SELECTOR = 'g[clip-path*="whale"]'
const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_IMAGE_EDGE = 256
const CHANGE_EVENT = 'dsh-workos-tenant:branding-change'
const FAVICON_SELECTOR = 'link[rel~="icon"]'

function compressImage(dataUrl) {
  return new Promise(resolve => {
    const image = new Image()
    image.onload = () => {
      try {
        const sourceWidth = image.naturalWidth || image.width
        const sourceHeight = image.naturalHeight || image.height
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(sourceWidth * scale))
        canvas.height = Math.max(1, Math.round(sourceHeight * scale))
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(dataUrl)
      }
    }
    image.onerror = () => resolve(dataUrl)
    image.src = dataUrl
  })
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => compressImage(String(reader.result)).then(resolve)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function ImageField({ kind, value, onChange, t }) {
  const isLogo = kind === 'logo'
  const inputId = `dsh-workos-brand-${kind}`
  return (
    <div className="dsh-workos-brand__field">
      <div className="dsh-workos-brand__copy">
        <strong>{t(isLogo ? 'brandLogo' : 'brandWordmark')}</strong>
        <span>{t(isLogo ? 'brandLogoHint' : 'brandWordmarkHint')}</span>
      </div>
      <div className="dsh-workos-brand__controls">
        <div className="dsh-workos-brand__preview">
          {value ? <img src={value} alt="" /> : <span>{t('brandDefault')}</span>}
        </div>
        <label className="dsh-workos-brand__button" htmlFor={inputId}>{t('brandChooseImage')}</label>
        <input
          id={inputId}
          className="dsh-workos-brand__file"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={event => {
            const file = event.target.files?.[0]
            if (file) void readImage(file).then(onChange)
            event.target.value = ''
          }}
        />
        {value && <button type="button" className="dsh-workos-brand__button dsh-workos-brand__button--danger" onClick={() => onChange(null)}>{t('brandReset')}</button>}
      </div>
    </div>
  )
}

function RunningIcon({ icon }) {
  return (
    <span className="dsh-workos-running-icon" data-icon={icon} aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742" stroke="currentColor" />
      </svg>
    </span>
  )
}

function HeroLogo({ logo, size = 34, className }) {
  if (logo) return <img className={className} src={logo} alt="" aria-hidden="true" width={size} height={size} style={{ objectFit: 'contain', animation: 'none' }} />
  return <svg className={className} width={size} height={size} viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`} aria-hidden="true"><path d={FISH_LOGO_PATH} fill="currentColor" /></svg>
}

export function BrandingSettings({ t }) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState()

  useEffect(() => {
    let active = true
    void fetch('/auth/tenant-branding', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        const value = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(value.detail || t('brandLoadFailed'))
        if (active) {
          setBranding({ ...DEFAULT_BRANDING, ...value.branding })
          setStatus('ready')
        }
      })
      .catch(reason => {
        if (!active) return
        setError(reason.message)
        setStatus('error')
      })
    return () => { active = false }
  }, [t])

  const save = event => {
    event.preventDefault()
    setStatus('saving')
    setError(undefined)
    void fetch('/auth/tenant-branding', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...branding, badge: branding.badge.trim() || DEFAULT_BRANDING.badge }),
    }).then(async response => {
      const value = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(value.detail || value.error || t('brandSaveFailed'))
      setBranding({ ...DEFAULT_BRANDING, ...value.branding })
      setStatus('saved')
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
    }).catch(reason => {
      setError(reason.message)
      setStatus('error')
    })
  }

  if (status === 'loading') return <section className="dsh-workos-brand dsh-workos-settings__group"><p className="dsh-workos-settings__status">{t('brandLoading')}</p></section>
  if (status === 'error') return <section className="dsh-workos-brand dsh-workos-settings__group"><p className="dsh-workos-settings__error">{error}</p></section>

  return (
    <form className="dsh-workos-brand dsh-workos-settings__group" onSubmit={save}>
      <h3 className="dsh-workos-settings__title">{t('branding')}</h3>
      <p className="dsh-workos-brand__intro">{t('brandingHint')}</p>
      <ImageField kind="logo" value={branding.logo} onChange={logo => setBranding(current => ({ ...current, logo }))} t={t} />
      <ImageField kind="wordmark" value={branding.wordmark} onChange={wordmark => setBranding(current => ({ ...current, wordmark }))} t={t} />
      <label className="dsh-workos-settings__field dsh-workos-settings__field--wide">
        <span className="dsh-workos-settings__label">{t('brandBadge')}</span>
        <input className="dsh-workos-settings__input" value={branding.badge} maxLength={30} onChange={event => setBranding(current => ({ ...current, badge: event.target.value }))} />
        <span className="dsh-workos-settings__hint">{t('brandBadgeHint')}</span>
      </label>
      <div className="dsh-workos-brand__hero">
        <h4 className="dsh-workos-settings__label">{t('brandHero')}</h4>
        <p className="dsh-workos-settings__hint">{t('brandHeroLogoHint')}</p>
        <label className="dsh-workos-settings__field dsh-workos-settings__field--wide">
          <span className="dsh-workos-settings__label">{t('brandHeroHeadline')}</span>
          <input className="dsh-workos-settings__input" value={branding.heroHeadline ?? ''} placeholder={t('brandHeroHeadlineDefault')} onChange={event => setBranding(current => ({ ...current, heroHeadline: event.target.value }))} />
          <span className="dsh-workos-settings__hint">{t('brandHeroTextHint')}</span>
        </label>
        <label className="dsh-workos-settings__field dsh-workos-settings__field--wide">
          <span className="dsh-workos-settings__label">{t('brandHeroBadgeText')}</span>
          <input className="dsh-workos-settings__input" value={branding.heroBadgeText ?? ''} placeholder={t('brandHeroBadgeDefault')} onChange={event => setBranding(current => ({ ...current, heroBadgeText: event.target.value }))} />
          <span className="dsh-workos-settings__hint">{t('brandHeroTextHint')}</span>
        </label>
        <label className="dsh-workos-brand__toggle">
          <input type="checkbox" checked={branding.heroBadgeVisible} onChange={event => setBranding(current => ({ ...current, heroBadgeVisible: event.target.checked }))} />
          <span>{t('brandHeroBadgeVisible')}</span>
        </label>
        <div className="dsh-workos-brand__hero-preview" aria-label={t('brandHeroPreview')}>
          <HeroLogo logo={branding.logo} />
          <span>{branding.heroHeadline?.trim() || t('brandHeroHeadlineDefault')}</span>
          {branding.heroBadgeVisible && <span className="dsh-workos-brand__hero-badge">{branding.heroBadgeText?.trim() || t('brandHeroBadgeDefault')}</span>}
        </div>
      </div>
      <div className="dsh-workos-brand__running">
        <h4 className="dsh-workos-settings__label">{t('brandRunning')}</h4>
        <fieldset className="dsh-workos-brand__icons">
          <legend className="dsh-workos-settings__label">{t('brandRunningIcon')}</legend>
          {RUNNING_ICONS.map(icon => (
            <label key={icon} className="dsh-workos-brand__icon-option">
              <input type="radio" name="runningIcon" value={icon} checked={branding.runningIcon === icon} onChange={() => setBranding(current => ({ ...current, runningIcon: icon }))} />
              <RunningIcon icon={icon} />
              <span>{t(`brandRunningIcon_${icon}`)}</span>
            </label>
          ))}
        </fieldset>
        <label className="dsh-workos-settings__field dsh-workos-settings__field--wide">
          <span className="dsh-workos-settings__label">{t('brandRunningText')}</span>
          <input className="dsh-workos-settings__input" value={branding.runningText ?? ''} placeholder={t('brandRunningDefaultText')} onChange={event => setBranding(current => ({ ...current, runningText: event.target.value }))} />
          <span className="dsh-workos-settings__hint">{t('brandRunningTextHint')}</span>
        </label>
        <div className="dsh-workos-brand__running-preview" aria-label={t('brandRunningPreview')}>
          <RunningIcon icon={branding.runningIcon} />
          <span>{branding.runningText?.trim() || t('brandRunningDefaultText')}</span>
        </div>
      </div>
      <div className="dsh-workos-brand__actions">
        <button type="submit" className="dsh-workos-brand__button dsh-workos-brand__button--primary" disabled={status === 'saving'}>{status === 'saving' ? t('brandSaving') : t('brandSave')}</button>
        <button type="button" className="dsh-workos-brand__button" onClick={() => setBranding(DEFAULT_BRANDING)}>{t('brandResetAll')}</button>
        {status === 'saved' && <span className="dsh-workos-settings__status">{t('brandSaved')}</span>}
        {error && <span className="dsh-workos-settings__error">{error}</span>}
      </div>
    </form>
  )
}

function addImage(svg, key, value, x, y, width, height, preserveAspectRatio = 'xMidYMid meet') {
  if (!value) return
  const image = document.createElementNS(SVG_NS, 'image')
  image.dataset.dshWorkosBranding = key
  image.setAttribute('x', String(x))
  image.setAttribute('y', String(y))
  image.setAttribute('width', String(width))
  image.setAttribute('height', String(height))
  image.setAttribute('preserveAspectRatio', preserveAspectRatio)
  image.setAttribute('pointer-events', 'none')
  image.setAttribute('href', value)
  image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', value)
  svg.appendChild(image)
}

function clearSvg(svg) {
  if (!svg) return
  svg.querySelectorAll('[data-dsh-workos-branding]').forEach(element => element.remove())
  svg.querySelector(BADGE_TEXT_SELECTOR)?.style.removeProperty('display')
  svg.querySelector(WHALE_SELECTOR)?.style.removeProperty('display')
  for (const child of svg.children) if (child.tagName === 'path') child.style.removeProperty('display')
}

function renderBadge(svg, value) {
  if (value.badge === DEFAULT_BRANDING.badge) return
  svg.querySelector(BADGE_TEXT_SELECTOR)?.style.setProperty('display', 'none')
  const badge = document.createElementNS(SVG_NS, 'foreignObject')
  badge.dataset.dshWorkosBranding = 'badge'
  badge.setAttribute('x', '132.348')
  badge.setAttribute('y', '5.5')
  badge.setAttribute('width', '46')
  badge.setAttribute('height', '14')
  const label = document.createElement('div')
  label.className = 'dsh-workos-brand__badge'
  label.textContent = value.badge
  badge.appendChild(label)
  svg.appendChild(badge)
}

function renderBrand(svg, value) {
  clearSvg(svg)
  if (value.wordmark) {
    for (const child of svg.children) if (child.tagName === 'path') child.style.display = 'none'
    addImage(svg, 'wordmark', value.wordmark, 27, 7.66, 94, 13.84, 'xMidYMid slice')
  }
  if (value.logo) {
    svg.querySelector(WHALE_SELECTOR)?.style.setProperty('display', 'none')
    addImage(svg, 'logo', value.logo, 0.14, 3.52, 23.16, 17.04, 'xMidYMid slice')
  }
  renderBadge(svg, value)
}

function renderBrandName(svg, value) {
  clearSvg(svg)
  if (value.wordmark) {
    for (const child of svg.children) if (child.tagName === 'path') child.style.display = 'none'
    addImage(svg, 'wordmark', value.wordmark, 27, 7.66, 94, 13.84, 'xMidYMid slice')
  }
  renderBadge(svg, value)
}

function renderBrandMark(svg, value) {
  clearSvg(svg)
  if (!value.logo) return
  for (const child of svg.children) if (child.tagName === 'path') child.style.display = 'none'
  addImage(svg, 'logo', value.logo, 0.14, 0, 23.16, 17.04, 'xMidYMid slice')
}

function findBrandTargets() {
  const legacy = document.querySelector(LEGACY_BRAND_SELECTOR)
  if (legacy) return { name: legacy, mark: undefined, legacy: true }
  const name = document.querySelector(BRAND_NAME_SELECTOR)
  if (!name) return { name: undefined, mark: undefined, legacy: false }
  const identity = name.parentElement?.parentElement
  const mark = identity?.querySelector(BRAND_MARK_SELECTOR) ?? document.querySelector(BRAND_MARK_SELECTOR)
  return { name, mark, legacy: false }
}

function applyDocumentBranding(value, originalFavicons) {
  document.title = value.badge
  let favicon = document.head.querySelector('[data-dsh-workos-branding="favicon"]')
  if (!value.logo) {
    favicon?.remove()
    for (const { element, href } of originalFavicons) {
      if (!element.isConnected) continue
      if (href === null) element.removeAttribute('href')
      else element.setAttribute('href', href)
    }
    return
  }
  if (!favicon) {
    favicon = document.createElement('link')
    favicon.dataset.dshWorkosBranding = 'favicon'
    favicon.setAttribute('rel', 'icon')
    favicon.setAttribute('type', 'image/png')
    document.head.appendChild(favicon)
  }
  favicon.setAttribute('href', value.logo)
  for (const link of document.head.querySelectorAll(FAVICON_SELECTOR)) {
    if (link !== favicon) link.setAttribute('href', value.logo)
  }
}

function installBrandingUnsafe(ctx) {
  const runningStatus = installRunningStatus(ctx.locale)
  const heroLogo = installHeroLogo(ctx.slots, logo => function HeroBrandMark(props) {
    return <HeroLogo {...props} logo={logo} />
  })
  const originalTitle = document.title
  const originalFavicons = [...document.head.querySelectorAll(FAVICON_SELECTOR)].map(element => ({
    element,
    href: element.getAttribute('href'),
  }))
  let currentTargets
  let currentValue
  let currentSignature
  const ensure = () => {
    const value = currentValue ?? DEFAULT_BRANDING
    runningStatus.update(value)
    heroLogo.update(value.logo)
    applyDocumentBranding(value, originalFavicons)
    const targets = findBrandTargets()
    if (!targets.name) return
    const signature = `${value.badge}|${value.logo || ''}|${value.wordmark || ''}`
    const changed = targets.name !== currentTargets?.name || targets.mark !== currentTargets?.mark || signature !== currentSignature
    const missing = (value.badge !== DEFAULT_BRANDING.badge && !targets.name.querySelector('[data-dsh-workos-branding="badge"]')) ||
      (!targets.legacy && targets.mark && value.logo && !targets.mark.querySelector('[data-dsh-workos-branding="logo"]'))
    if (changed || missing) {
      if (currentTargets?.name && currentTargets.name !== targets.name) clearSvg(currentTargets.name)
      if (currentTargets?.mark && currentTargets.mark !== targets.mark) clearSvg(currentTargets.mark)
      if (targets.legacy) renderBrand(targets.name, value)
      else {
        renderBrandName(targets.name, value)
        if (targets.mark) renderBrandMark(targets.mark, value)
      }
      currentTargets = targets
      currentSignature = signature
    }
  }
  const load = () => {
    void fetch('/auth/tenant-branding', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : undefined)
      .then(value => { if (value?.branding) { currentValue = value.branding; ensure() } })
      .catch(() => {})
  }
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-workos-tenant/branding'
  style.textContent = `
    ${runningStatusStyles}
    .dsh-workos-brand__intro { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; margin: 0 0 14px; }
    .dsh-workos-brand__field { display: flex; gap: 16px; align-items: center; padding: 12px 0; border-top: 1px solid var(--dsw-alias-border-l2); }
    .dsh-workos-brand__copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .dsh-workos-brand__copy strong { font-size: 13px; font-weight: 500; }
    .dsh-workos-brand__copy span { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
    .dsh-workos-brand__controls { display: flex; align-items: center; gap: 8px; flex: none; }
    .dsh-workos-brand__preview { width: 86px; height: 42px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
    .dsh-workos-brand__preview img { width: 100%; height: 100%; object-fit: contain; }
    .dsh-workos-brand__file { display: none; }
    .dsh-workos-brand__button { appearance: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 7px 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }
    .dsh-workos-brand__button:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .dsh-workos-brand__button--primary { background: var(--dsw-alias-state-business-primary); border-color: transparent; color: white; }
    .dsh-workos-brand__button--danger { color: var(--dsw-alias-label-error); }
    .dsh-workos-brand__actions { display: flex; align-items: center; gap: 10px; padding-top: 16px; }
    .dsh-workos-brand__running, .dsh-workos-brand__hero { border-top: 1px solid var(--dsw-alias-border-l2); margin-top: 16px; padding-top: 16px; }
    .dsh-workos-brand__running h4, .dsh-workos-brand__hero h4 { margin: 0 0 12px; }
    .dsh-workos-brand__toggle { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 13px; cursor: pointer; }
    .dsh-workos-brand__toggle input { margin: 0; accent-color: var(--dsw-alias-state-business-primary); }
    .dsh-workos-brand__hero-preview { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; padding: 20px 12px; margin-top: 14px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 6px; }
    .dsh-workos-brand__hero-preview img { width: 34px; height: 34px; object-fit: contain; flex: none; }
    .dsh-workos-brand__hero-preview > span { overflow-wrap: anywhere; min-width: 0; }
    .dsh-workos-brand__hero-badge { border-radius: 999px; padding: 2px 7px; background: var(--dsw-alias-state-business-tertiary); color: var(--dsw-alias-label-primary-bluish); font-size: 12px; }
    [data-dsh-workos-hero-preview="hidden"] [class$="_titleGroup"] > [class$="_previewBadge"] { display: none !important; }
    [class$="_headline"]:has(> [class$="_fishHitbox"]) [class$="_titleGroup"] > span { overflow-wrap: anywhere; max-width: 100%; white-space: normal; }
    .dsh-workos-brand__icons { border: 0; padding: 0; margin: 0 0 14px; display: flex; gap: 8px; flex-wrap: wrap; }
    .dsh-workos-brand__icons legend { margin-bottom: 8px; }
    .dsh-workos-brand__icon-option { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; font-size: 12px; cursor: pointer; }
    .dsh-workos-brand__icon-option:has(input:checked) { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-state-business-primary); }
    .dsh-workos-brand__icon-option input { margin: 0; accent-color: var(--dsw-alias-state-business-primary); }
    .dsh-workos-brand__running-preview { display: flex; align-items: center; gap: 6px; margin-top: 12px; min-width: 0; color: var(--dsw-alias-label-deep-diving, var(--dsw-alias-state-business-primary)); font-size: 12px; }
    .dsh-workos-brand__running-preview > span:last-child { overflow-wrap: anywhere; white-space: pre-wrap; }
    [data-chat-running] [class$="_runningText"] { overflow-wrap: anywhere; }
    .dsh-workos-brand__badge { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; box-sizing: border-box; padding: 0 1px; color: var(--dsw-alias-label-primary-inverted, #fff); font-family: inherit; font-size: 10px; font-weight: 400; line-height: 14px; letter-spacing: .4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media (max-width: 680px) { .dsh-workos-brand__field { align-items: flex-start; flex-direction: column; } .dsh-workos-brand__controls { width: 100%; flex-wrap: wrap; } }
  `
  document.head.appendChild(style)
  const timer = window.setInterval(ensure, 600)
  const onChange = () => { load() }
  window.addEventListener(CHANGE_EVENT, onChange)
  load()
  ensure()
  return () => {
    window.clearInterval(timer)
    window.removeEventListener(CHANGE_EVENT, onChange)
    runningStatus.dispose()
    heroLogo.dispose()
    clearSvg(currentTargets?.name)
    clearSvg(currentTargets?.mark)
    document.head.querySelector('[data-dsh-workos-branding="favicon"]')?.remove()
    for (const { element, href } of originalFavicons) {
      if (!element.isConnected) document.head.appendChild(element)
      if (href === null) element.removeAttribute('href')
      else element.setAttribute('href', href)
    }
    style.remove()
    document.title = originalTitle
  }
}

/**
 * Branding is an optional DOM enhancement. A host shell can activate the
 * client plugin before its document chrome is ready, so a DOM failure here
 * must not abort the whole client plugin tree.
 */
export function installBranding(ctx) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  try {
    return installBrandingUnsafe(ctx)
  } catch (error) {
    console.error('[dsh-workos-tenant] branding enhancement unavailable', error)
  }
}
