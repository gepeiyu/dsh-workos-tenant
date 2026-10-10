import test from 'node:test'
import assert from 'node:assert/strict'
import { customizeRunningLabel, installRunningStatus } from '../src/client/running-status.js'

test('custom running text preserves elapsed time and treats special characters literally', () => {
  assert.equal(customizeRunningLabel('深度求索中，用时 8秒 ···', '深度求索中', '<处理中> {duration} $&'), '<处理中> {duration} $&，用时 8秒 ···')
  assert.equal(customizeRunningLabel('Deep diving for 2m 3s ···', 'Deep diving', 'Working'), 'Working for 2m 3s ···')
  assert.equal(customizeRunningLabel('深度求索中', '深度求索中', '执行中'), '执行中')
  assert.equal(customizeRunningLabel('Deep diving', 'Deep diving', null), 'Deep diving')
})

test('running status refreshes mounted labels, keeps other translations, and restores on disposal', t => {
  const originalDocument = globalThis.document
  globalThis.document = { documentElement: { dataset: {} } }
  t.after(() => { globalThis.document = originalDocument })
  let revision = 0
  const dictionaries = new Set()
  const locale = {
    language: 'zh',
    register(ns) {
      dictionaries.add(ns)
      revision++
      return () => { dictionaries.delete(ns); revision++ }
    },
    translate(ns, key, params) {
      if (ns !== 'chat') return key
      const text = this.language === 'zh' ? '深度求索中' : 'Deep diving'
      if (key === 'chat.deepDiving') return text
      if (key === 'chat.deepDivingFor') return this.language === 'zh' ? `${text}，用时 ${params.duration} ···` : `${text} for ${params.duration} ···`
      return key
    },
  }
  const originalTranslate = locale.translate
  const status = installRunningStatus(locale)
  status.update({ runningText: '处理 $& {duration}', runningIcon: 'spinner' })
  const savedRevision = revision
  assert.equal(locale.translate('chat', 'chat.deepDiving'), '处理 $& {duration}')
  assert.equal(locale.translate('chat', 'chat.deepDivingFor', { duration: '8秒' }), '处理 $& {duration}，用时 8秒 ···')
  assert.equal(locale.translate('other', 'chat.deepDiving'), 'chat.deepDiving')
  assert.equal(globalThis.document.documentElement.dataset.dshWorkosRunningIcon, 'spinner')
  status.update({ runningText: '处理 $& {duration}', runningIcon: 'dots' })
  assert.equal(revision, savedRevision)
  locale.language = 'en'
  assert.equal(locale.translate('chat', 'chat.deepDivingFor', { duration: '9s' }), '处理 $& {duration} for 9s ···')
  status.update({ runningText: null, runningIcon: 'whale' })
  assert.ok(revision > savedRevision)
  assert.equal(locale.translate('chat', 'chat.deepDiving'), 'Deep diving')
  status.dispose()
  assert.equal(locale.translate, originalTranslate)
  assert.equal(dictionaries.size, 0)
  assert.deepEqual(globalThis.document.documentElement.dataset, {})
})
