/** Clear the legacy browser-wide selection before any account's UI resumes. */
export function installSessionVisibility(ctx, request = globalThis.fetch) {
  const sessions = ctx.sessions
  // DSH 0.2 moved selection state out of ClientSessions and removed this method.
  // Keep the call for older hosts without making activation depend on it.
  if (typeof sessions.clear === 'function') sessions.clear()
  let disposed = false
  void request('/auth/resources', { credentials: 'same-origin', cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`Tenant policy is unavailable (${response.status})`)
      if (!disposed) return sessions.refresh()
    })
    .catch(error => { console.error('[dsh-workos-tenant] navigation initialization failed', error) })
  return () => { disposed = true }
}

/** The sidebar caches panel metadata before this plugin activates. Hide the
 * native button using its registered label, including in the collapsed rail. */
export function installPluginMenuVisibility(ctx, canManagePlugins) {
  const style = document.createElement('style')
  style.dataset.pluginCss = 'dsh-workos-tenant/plugin-menu'
  document.head.appendChild(style)
  const refresh = () => {
    if (canManagePlugins()) {
      style.textContent = ''
      return
    }
    const selectors = ctx.slots.entriesOfSlot('sidebar.panellist')
      .filter(entry => entry.options.id === 'plugins')
      .map(({ options }) => {
        const label = typeof options.label === 'function' ? options.label() : options.label
        return `[data-pane="sidebar"] nav button[aria-label="${CSS.escape(label ?? options.id)}"]`
      })
    style.textContent = selectors.length ? `${selectors.join(',\n')} { display: none !important; }` : ''
  }
  const offPanels = ctx.slots.subscribe('sidebar.panellist', refresh)
  const offLocale = ctx.locale.subscribe(refresh)
  refresh()
  return {
    refresh,
    dispose() {
      offPanels()
      offLocale()
      style.remove()
    },
  }
}
