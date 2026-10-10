import test from 'node:test'
import assert from 'node:assert/strict'
import { customizeRunningLabel, installRunningStatus } from '../src/client/running-status.js'

test('custom running text preserves elapsed time and treats special characters literally', () => {
  assert.equal(customizeRunningLabel('深度求索中，用时 8秒 ···', '深度求索中', '<处理中> {duration} $&'), '<处理中> {duration} $&，用时 8秒 ···')
  assert.equal(customizeRunningLabel('Deep diving for 2m 3s ···', 'Deep diving', 'Working'), 'Working for 2m 3s ···')
  assert.equal(customizeRunningLabel('8秒 深く考えています ···', '深く考えています', '処理中'), '8秒 処理中 ···')
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
    register(ns, values) {
      assert.deepEqual(Object.keys(values).sort(), ['en', 'ja', 'zh'])
      assert.deepEqual(values.ja, values.en)
      dictionaries.add(ns)
      revision++
      return () => { dictionaries.delete(ns); revision++ }
    },
    translate(ns, key, params) {
      if (ns === 'conversation') {
        if (key === 'hero.headline') return this.language === 'zh' ? '探索未至之境' : 'Into the Unknown'
        if (key === 'hero.preview') return this.language === 'zh' ? '预览版' : 'Preview'
      }
      if (ns !== 'chat') return key
      const text = { zh: '深度求索中', en: 'Deep diving', ja: '深く考えています' }[this.language]
      if (key === 'chat.deepDiving') return text
      if (key === 'chat.deepDivingFor') {
        if (this.language === 'ja') return `${params.duration} ${text} ···`
        return this.language === 'zh' ? `${text}，用时 ${params.duration} ···` : `${text} for ${params.duration} ···`
      }
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
  locale.language = 'ja'
  assert.equal(locale.translate('chat', 'chat.deepDivingFor', { duration: '9秒' }), '9秒 处理 $& {duration} ···')
  status.update({ runningText: null, runningIcon: 'whale' })
  assert.ok(revision > savedRevision)
  assert.equal(locale.translate('chat', 'chat.deepDiving'), '深く考えています')
  locale.language = 'en'
  assert.equal(locale.translate('chat', 'chat.deepDiving'), 'Deep diving')
  status.dispose()
  assert.equal(locale.translate, originalTranslate)
  assert.equal(dictionaries.size, 0)
  assert.deepEqual(globalThis.document.documentElement.dataset, {})
})

test('welcome text and badge stay literal, refresh when changed, and restore localized defaults', t => {
  const originalDocument = globalThis.document
  globalThis.document = { documentElement: { dataset: {} } }
  t.after(() => { globalThis.document = originalDocument })
  let revision = 0
  const locale = {
    register() { revision++; return () => { revision++ } },
    translate(ns, key) {
      if (ns !== 'conversation') return key
      return { 'hero.headline': '探索未至之境', 'hero.preview': '预览版' }[key] ?? key
    },
  }
  const status = installRunningStatus(locale)
  status.update({ heroHeadline: '<欢迎> {name} $&', heroBadgeText: '内测 {name}', heroBadgeVisible: false })
  assert.equal(locale.translate('conversation', 'hero.headline', { name: 'ignored' }), '<欢迎> {name} $&')
  assert.equal(locale.translate('conversation', 'hero.preview'), '内测 {name}')
  assert.equal(locale.translate('other', 'hero.headline'), 'hero.headline')
  assert.equal(globalThis.document.documentElement.dataset.dshWorkosHeroPreview, 'hidden')
  const savedRevision = revision
  status.update({ heroHeadline: '欢迎', heroBadgeText: '正式版', heroBadgeVisible: true })
  assert.ok(revision > savedRevision)
  assert.equal(locale.translate('conversation', 'hero.headline'), '欢迎')
  assert.equal(globalThis.document.documentElement.dataset.dshWorkosHeroPreview, 'visible')
  status.update({})
  assert.equal(locale.translate('conversation', 'hero.headline'), '探索未至之境')
  assert.equal(locale.translate('conversation', 'hero.preview'), '预览版')
  status.dispose()
})
