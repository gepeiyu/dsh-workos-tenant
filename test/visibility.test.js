import test from 'node:test'
import assert from 'node:assert/strict'
import { installSessionVisibility } from '../src/client/visibility.js'

test('client session visibility keeps only the authenticated list baseline', async () => {
  let state = {
    ids: ['alice', 'bob'],
    byId: { alice: { sessionId: 'alice' }, bob: { sessionId: 'bob' } },
    current: 'bob',
    phase: 'ready',
    subagentsByParent: { alice: { items: [] }, bob: { items: [] } },
    jobsBySession: { alice: [], bob: [] },
    currentAddress: undefined,
  }
  const calls = []
  const sessions = {
    list: {
      getSnapshot: () => state,
      set: next => { state = next },
    },
    async refresh() {
      calls.push('refresh')
      state = { ...state, ids: ['alice'], byId: { alice: state.byId.alice }, current: undefined }
    },
    open(id) { calls.push(`open:${id}`) },
    handleSessionAdded(summary) { calls.push(`add:${summary.sessionId}`) },
    handleSessionRemoved(id) { calls.push(`remove:${id}`) },
    handleSessionStatus(id) { calls.push(`status:${id}`) },
    handleSessionActivity(id) { calls.push(`activity:${id}`) },
    handleSessionError(id) { calls.push(`error:${id}`) },
  }
  const ctx = { sessions }
  const dispose = installSessionVisibility(ctx)
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(sessions.list.getSnapshot().ids, ['alice'])
  sessions.handleSessionStatus('bob', true)
  sessions.handleSessionActivity('bob', 1)
  sessions.handleSessionAdded({ sessionId: 'bob' })
  sessions.handleSessionAdded({ sessionId: 'alice' })
  sessions.open('bob')
  sessions.open('alice')
  assert.deepEqual(calls, ['refresh', 'refresh', 'add:alice', 'open:alice'])
  dispose()
  sessions.open('bob')
  assert.deepEqual(calls, ['refresh', 'refresh', 'add:alice', 'open:alice', 'open:bob'])
})
