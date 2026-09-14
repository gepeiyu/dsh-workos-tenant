import test from 'node:test'
import assert from 'node:assert/strict'
import { installSessionVisibility } from '../src/client/visibility.js'

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
