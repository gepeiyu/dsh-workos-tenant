/** Clear Harness's browser-wide selection before any account's UI resumes. */
export function installSessionVisibility(ctx, request = globalThis.fetch) {
  const sessions = ctx.sessions
  sessions.clear()
  let disposed = false
  void request('/auth/resources', { credentials: 'same-origin', cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`Tenant policy is unavailable (${response.status})`)
      if (!disposed) return sessions.refresh()
    })
    .catch(error => { console.error('[dsh-workos-tenant] navigation initialization failed', error) })
  return () => { disposed = true }
}
