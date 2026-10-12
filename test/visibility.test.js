import test from 'node:test'
import assert from 'node:assert/strict'
import { installPluginMenuVisibility, installSessionVisibility } from '../src/client/visibility.js'

test('plugin menu visibility follows account readiness, late panel registration, locale, and disposal', t => {
  let removed = false
  const style = { dataset: {}, textContent: '', remove() { removed = true } }
  for (const [name, value] of Object.entries({
    document: { createElement: () => style, head: { appendChild() {} } },
    CSS: { escape: value => value },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    })
  }
  const panels = new Set()
  const locales = new Set()
  let entries = []
  let label = '插件'
  let role = 'loading'
  const menu = installPluginMenuVisibility({
    slots: {
      entriesOfSlot: name => {
        assert.equal(name, 'sidebar.panellist')
        return entries
      },
      subscribe(name, listener) {
        assert.equal(name, 'sidebar.panellist')
        panels.add(listener)
        return () => panels.delete(listener)
      },
    },
    locale: { subscribe(listener) { locales.add(listener); return () => locales.delete(listener) } },
  }, () => ['owner', 'admin', 'local'].includes(role))

  entries = [
    { options: { id: 'schedules', label: '自动任务' } },
    { options: { id: 'plugins', label: () => label } },
  ]
  for (const listener of panels) listener()
  assert.match(style.textContent, /:is\(\[data-pane="sidebar"\], \[class\*="_sidebarCol"\]\) nav button\[aria-label="插件"\]/)
  assert.doesNotMatch(style.textContent, /自动任务/)
  for (role of ['member', 'signed-out', 'error', 'loading']) {
    menu.refresh()
    assert.match(style.textContent, /display: none !important/)
  }
  for (role of ['owner', 'admin', 'local']) {
    menu.refresh()
    assert.equal(style.textContent, '')
  }
  role = 'member'
  for (label of ['Plugins', 'プラグイン']) {
    for (const listener of locales) listener()
    assert.ok(style.textContent.includes(`aria-label="${label}"`))
  }
  menu.dispose()
  assert.equal(removed, true)
  assert.equal(panels.size, 0)
  assert.equal(locales.size, 0)
})

test('login clears the shared selection without replacing session snapshot readers', async () => {
  const calls = []
  const snapshot = { ids: ['own'], current: 'old-account-session' }
  const getSnapshot = () => snapshot
  const sessions = {
    list: { getSnapshot },
    clear() { calls.push('clear'); snapshot.current = undefined },
    async refresh() { calls.push('refresh') },
    async create() { return 'new-own-session' },
  }
  const originalCreate = sessions.create
  installSessionVisibility({ sessions }, async (url, options) => {
    assert.equal(url, '/auth/resources')
    assert.equal(options.credentials, 'same-origin')
    assert.deepEqual(calls, ['clear'])
    return { ok: true }
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['clear', 'refresh'])
  assert.equal(snapshot.current, undefined)
  assert.equal(sessions.list.getSnapshot, getSnapshot)
  assert.equal(sessions.create, originalCreate)
  assert.deepEqual(sessions.list.getSnapshot().ids, ['own'])
})

test('login refreshes sessions when the current host has no legacy clear method', async () => {
  const calls = []
  const sessions = {
    list: { getSnapshot: () => ({ ids: ['own'] }) },
    async refresh() { calls.push('refresh') },
  }
  installSessionVisibility({ sessions }, async () => ({ ok: true }))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['refresh'])
})
