const HERO_MARK_SLOT = 'conversation.hero.brand.mark'

export function installHeroLogo(slots, createComponent) {
  let currentLogo = null
  let unregister
  return {
    update(logo) {
      logo = logo || null
      if (logo === currentLogo) return
      unregister?.()
      unregister = undefined
      currentLogo = logo
      if (!logo) return
      unregister = slots.inject(HERO_MARK_SLOT, () => slots.register({
        name: HERO_MARK_SLOT,
        priority: -100,
      }, createComponent(logo)))
    },
    dispose() {
      unregister?.()
      unregister = undefined
      currentLogo = null
    },
  }
}
