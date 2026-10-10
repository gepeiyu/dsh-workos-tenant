import { DEFAULT_BRANDING } from '../branding.js'

const NS = 'workos.running-status'

// Keep the host's localized duration and punctuation; user text stays literal.
export function customizeRunningLabel(label, defaultText, customText) {
  if (customText == null) return label
  return label.replace(defaultText, () => customText)
}

export function installRunningStatus(locale) {
  let current = DEFAULT_BRANDING
  const originalTranslate = locale.translate
  const translate = (ns, key, params) => originalTranslate.call(locale, ns, key, params)
  const register = () => locale.register(NS, {
    zh: { label: current.runningText ?? '', headline: current.heroHeadline ?? '', badge: current.heroBadgeText ?? '' },
    en: { label: current.runningText ?? '', headline: current.heroHeadline ?? '', badge: current.heroBadgeText ?? '' },
    ja: { label: current.runningText ?? '', headline: current.heroHeadline ?? '', badge: current.heroBadgeText ?? '' },
  })
  let unregister = register()
  locale.translate = (ns, key, params) => {
    const label = translate(ns, key, params)
    if (ns === 'conversation') {
      if (key === 'hero.headline') return current.heroHeadline ?? label
      if (key === 'hero.preview') return current.heroBadgeText ?? label
    }
    if (ns !== 'chat' || !['chat.deepDiving', 'chat.deepDivingFor'].includes(key)) return label
    return customizeRunningLabel(label, translate('chat', 'chat.deepDiving'), current.runningText)
  }

  return {
    update(value) {
      const next = { ...DEFAULT_BRANDING, ...value }
      document.documentElement.dataset.dshWorkosRunningIcon = next.runningIcon
      document.documentElement.dataset.dshWorkosHeroPreview = next.heroBadgeVisible ? 'visible' : 'hidden'
      if (next.runningText === current.runningText && next.heroHeadline === current.heroHeadline && next.heroBadgeText === current.heroBadgeText) return
      current = next
      // Dictionary registration publishes a locale revision, refreshing mounted
      // running labels (including the accessible status) immediately after save.
      unregister()
      unregister = register()
    },
    dispose() {
      locale.translate = originalTranslate
      unregister()
      delete document.documentElement.dataset.dshWorkosRunningIcon
      delete document.documentElement.dataset.dshWorkosHeroPreview
    },
  }
}

export const runningStatusStyles = `
  .dsh-workos-running-icon { width: 14px; height: 14px; position: relative; display: inline-flex; flex: none; }
  .dsh-workos-running-icon svg { width: 100%; height: 100%; }
  [data-dsh-workos-running-icon="spinner"] [data-chat-running] [class$="_runningIcon"] > *,
  [data-dsh-workos-running-icon="dots"] [data-chat-running] [class$="_runningIcon"] > * { display: none !important; }
  [data-dsh-workos-running-icon="spinner"] [data-chat-running] [class$="_runningIcon"]::after,
  .dsh-workos-running-icon[data-icon="spinner"]::after { content: ''; position: absolute; inset: 1px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: dsh-workos-running-spin .8s linear infinite; }
  [data-dsh-workos-running-icon="dots"] [data-chat-running] [class$="_runningIcon"]::after,
  .dsh-workos-running-icon[data-icon="dots"]::after { content: '...'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: bold 14px/14px sans-serif; animation: dsh-workos-running-dots 1.2s ease-in-out infinite; }
  .dsh-workos-running-icon:not([data-icon="whale"]) svg { display: none; }
  @keyframes dsh-workos-running-spin { to { transform: rotate(360deg); } }
  @keyframes dsh-workos-running-dots { 50% { opacity: .3; } }
  @media (prefers-reduced-motion: reduce) {
    [data-chat-running] [class$="_runningIcon"]::after, .dsh-workos-running-icon::after { animation: none !important; }
  }
`
