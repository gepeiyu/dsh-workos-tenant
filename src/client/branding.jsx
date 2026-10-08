import { useEffect, useState } from 'react'

const LEGACY_BRAND_SELECTOR = 'svg[viewBox="0 0 182 24"]'
const BRAND_NAME_SELECTOR = 'svg[viewBox="26 0 156 24"]'
const BRAND_MARK_SELECTOR = 'svg[viewBox="0 0 23.16 17.04"]'
const BADGE_TEXT_SELECTOR = 'g[clip-path*="badge"]'
const WHALE_SELECTOR = 'g[clip-path*="whale"]'
const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_IMAGE_EDGE = 256
const DEFAULT_BRANDING = { badge: 'HARNESS', logo: null, wordmark: null }
const CHANGE_EVENT = 'dsh-workos-tenant:branding-change'

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
          setBranding(value.branding ?? DEFAULT_BRANDING)
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
      setBranding(value.branding ?? DEFAULT_BRANDING)
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
      <div className="dsh-workos-brand__actions">
        <button type="submit" className="dsh-workos-brand__button dsh-workos-brand__button--primary" disabled={status === 'saving'}>{status === 'saving' ? t('brandSaving') : t('brandSave')}</button>
        <button type="button" className="dsh-workos-brand__button" onClick={() => setBranding(DEFAULT_BRANDING)}>{t('brandResetAll')}</button>
        {status === 'saved' && <span className="dsh-workos-settings__status">{t('brandSaved')}</span>}
        {error && <span className="dsh-workos-settings__error">{error}</span>}
      </div>
    </form>
  )
}

function addImage(svg, key, value, x, y, width, height) {
  if (!value) return
  const image = document.createElementNS(SVG_NS, 'image')
  image.dataset.dshWorkosBranding = key
  image.setAttribute('x', String(x))
  image.setAttribute('y', String(y))
  image.setAttribute('width', String(width))
  image.setAttribute('height', String(height))
  image.setAttribute('preserveAspectRatio', 'xMidYMid meet')
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

function renderBrand(svg, value) {
  clearSvg(svg)
  svg.querySelector(BADGE_TEXT_SELECTOR)?.style.setProperty('display', 'none')
  if (value.wordmark) {
    for (const child of svg.children) if (child.tagName === 'path') child.style.display = 'none'
    addImage(svg, 'wordmark', value.wordmark, 27, 7.66, 94, 13.84)
  }
  if (value.logo) {
    svg.querySelector(WHALE_SELECTOR)?.style.setProperty('display', 'none')
    addImage(svg, 'logo', value.logo, 0.14, 3.52, 23.16, 17.04)
  }
  const badge = document.createElementNS(SVG_NS, 'foreignObject')
  badge.dataset.dshWorkosBranding = 'badge'
  badge.setAttribute('x', '129.348')
  badge.setAttribute('y', '5.5')
  badge.setAttribute('width', '52')
  badge.setAttribute('height', '14')
  const label = document.createElement('div')
  label.className = 'dsh-workos-brand__badge'
  label.textContent = value.badge
  badge.appendChild(label)
  svg.appendChild(badge)
}

function renderBrandName(svg, value) {
  clearSvg(svg)
  svg.querySelector(BADGE_TEXT_SELECTOR)?.style.setProperty('display', 'none')
  if (value.wordmark) {
    for (const child of svg.children) if (child.tagName === 'path') child.style.display = 'none'
    addImage(svg, 'wordmark', value.wordmark, 27, 7.66, 94, 13.84)
  }
  const badge = document.createElementNS(SVG_NS, 'foreignObject')
  badge.dataset.dshWorkosBranding = 'badge'
  badge.setAttribute('x', '129.348')
  badge.setAttribute('y', '5.5')
  badge.setAttribute('width', '52')
  badge.setAttribute('height', '14')
  const label = document.createElement('div')
  label.className = 'dsh-workos-brand__badge'
  label.textContent = value.badge
  badge.appendChild(label)
  svg.appendChild(badge)
}

function renderBrandMark(svg, value) {
  clearSvg(svg)
  if (!value.logo) return
  for (const child of svg.children) if (child.tagName === 'path') child.style.display = 'none'
  addImage(svg, 'logo', value.logo, 0.14, 0, 23.16, 17.04)
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

function installBrandingUnsafe() {
  const originalTitle = document.title
  let currentTargets
  let currentValue
  let currentSignature
  const ensure = () => {
    const targets = findBrandTargets()
    if (!targets.name) return
    const value = currentValue ?? DEFAULT_BRANDING
    const signature = `${value.badge}|${value.logo || ''}|${value.wordmark || ''}`
    const changed = targets.name !== currentTargets?.name || targets.mark !== currentTargets?.mark || signature !== currentSignature
    const missing = !targets.name.querySelector('[data-dsh-workos-branding="badge"]') ||
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
    document.title = value.badge
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
    .dsh-workos-brand__badge { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; box-sizing: border-box; color: var(--dsw-alias-label-primary-inverted, #fff); font: 400 10px/1 inherit; letter-spacing: 1.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transform: scaleX(.82); }
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
    clearSvg(currentTargets?.name)
    clearSvg(currentTargets?.mark)
    style.remove()
    document.title = originalTitle
  }
}

/**
 * Branding is an optional DOM enhancement. A host shell can activate the
 * client plugin before its document chrome is ready, so a DOM failure here
 * must not abort the whole client plugin tree.
 */
export function installBranding() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  try {
    return installBrandingUnsafe()
  } catch (error) {
    console.error('[dsh-workos-tenant] branding enhancement unavailable', error)
  }
}
