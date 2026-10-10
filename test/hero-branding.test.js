import test from 'node:test'
import assert from 'node:assert/strict'
import { installHeroLogo } from '../src/client/hero-branding.js'

test('welcome logo waits for its slot, replaces images, and releases the native fallback on reset', () => {
  let callback
  let active
  let disposals = 0
  const slots = {
    inject(name, effect) {
      assert.equal(name, 'conversation.hero.brand.mark')
      callback = effect
      return () => { callback = undefined; active = undefined; disposals++ }
    },
    register(options, component) {
      active = { options, component }
      return () => { active = undefined }
    },
  }
  const logo = installHeroLogo(slots, src => ({ src }))
  logo.update(null)
  assert.equal(callback, undefined)
  logo.update('data:image/png;base64,AA==')
  assert.equal(active, undefined)
  callback()
  assert.equal(active.component.src, 'data:image/png;base64,AA==')
  assert.equal(active.options.priority, -100)
  logo.update('data:image/png;base64,AA==')
  assert.equal(disposals, 0)
  logo.update('data:image/png;base64,BB==')
  assert.equal(disposals, 1)
  callback()
  assert.equal(active.component.src, 'data:image/png;base64,BB==')
  logo.update(null)
  assert.equal(active, undefined)
  assert.equal(callback, undefined)
  logo.update('data:image/png;base64,AA==')
  logo.dispose()
  assert.equal(callback, undefined)
  assert.equal(disposals, 3)
})
