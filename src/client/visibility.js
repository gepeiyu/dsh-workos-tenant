function emptySessionSnapshot(snapshot) {
  return {
    ...snapshot,
    ids: [],
    byId: {},
    current: undefined,
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function filterSessionSnapshot(snapshot, visible) {
  const ids = snapshot.ids.filter(id => visible.has(id))
  const byId = Object.fromEntries(ids
    .map(id => [id, snapshot.byId[id]])
    .filter(([, value]) => value !== undefined))
  const subagentsByParent = Object.fromEntries(
    Object.entries(snapshot.subagentsByParent)
      .filter(([id]) => visible.has(id)),
  )
  const jobsBySession = Object.fromEntries(
    Object.entries(snapshot.jobsBySession)
      .filter(([id]) => visible.has(id)),
  )
  const current = snapshot.current !== undefined && visible.has(snapshot.current)
    ? snapshot.current
    : undefined
  const currentAddress = snapshot.currentAddress === undefined || (
    visible.has(snapshot.currentAddress.parentSessionId) &&
    visible.has(snapshot.currentAddress.childSessionId)
  ) ? snapshot.currentAddress : undefined
  return { ...snapshot, ids, byId, current, subagentsByParent, jobsBySession, currentAddress }
}

/**
 * Prevent globally forwarded api-session events from repopulating another
 * user's browser-side session mirror. The authoritative allowlist is refreshed
 * from the authenticated session.list RPC.
 */
export function installSessionVisibility(ctx) {
  const sessions = ctx.sessions
  const list = sessions?.list
  if (!sessions || !list) return () => {}

  const originalGetSnapshot = list.getSnapshot.bind(list)
  const originalRefresh = typeof sessions.refresh === 'function' ? sessions.refresh.bind(sessions) : undefined
  const originalOpen = typeof sessions.open === 'function' ? sessions.open.bind(sessions) : undefined
  const handlers = ['handleSessionAdded', 'handleSessionRemoved', 'handleSessionStatus', 'handleSessionActivity', 'handleSessionError']
    .filter(name => typeof sessions[name] === 'function')
    .map(name => [name, sessions[name].bind(sessions)])
  const visible = new Set()
  let ready = false
  let refreshPromise

  list.getSnapshot = () => ready
    ? filterSessionSnapshot(originalGetSnapshot(), visible)
    : emptySessionSnapshot(originalGetSnapshot())

  const refresh = async () => {
    if (refreshPromise) return refreshPromise
    refreshPromise = (async () => {
      if (originalRefresh) await originalRefresh()
      visible.clear()
      for (const id of originalGetSnapshot().ids) visible.add(id)
      ready = true
    })().finally(() => { refreshPromise = undefined })
    return refreshPromise
  }

  const originalByName = new Map(handlers)
  const added = originalByName.get('handleSessionAdded')
  if (added) sessions.handleSessionAdded = summary => {
    if (ready && visible.has(summary.sessionId)) return added(summary)
    void refresh()
  }
  for (const name of ['handleSessionRemoved', 'handleSessionStatus', 'handleSessionActivity', 'handleSessionError']) {
    const original = originalByName.get(name)
    if (!original) continue
    sessions[name] = (sessionId, ...args) => {
      if (!ready || !visible.has(sessionId)) return
      return original(sessionId, ...args)
    }
  }
  if (originalOpen) {
    sessions.open = id => {
      if (!ready || !visible.has(id)) return
      return originalOpen(id)
    }
  }
  void refresh()

  return () => {
    list.getSnapshot = originalGetSnapshot
    for (const [name, original] of handlers) sessions[name] = original
    if (originalOpen) sessions.open = originalOpen
  }
}
