import test from 'node:test'
import assert from 'node:assert/strict'
import { dictionaries } from '../src/client/locales.js'

test('all supported languages provide the full set of non-empty translations', () => {
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'ja', 'zh'])
  const keys = Object.keys(dictionaries.en).sort()
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    assert.deepEqual(Object.keys(dictionary).sort(), keys, `${language} translation keys`)
    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(typeof value, 'string', `${language}.${key}`)
      assert.ok(value.trim(), `${language}.${key} must not be blank`)
    }
  }
})
