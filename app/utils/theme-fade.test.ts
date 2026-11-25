import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileAppearance, defaultAppearance } from '../../shared/appearance'
import { FADE_QUIET_MS, fadesBetween, quietSince } from './theme-fade'

const compile = (change: Partial<typeof defaultAppearance>, mode: 'dark' | 'light' = 'dark') =>
  compileAppearance({ ...defaultAppearance, ...change }, mode)

test('a change of colour fades', () => {
  const dark = compile({})
  assert.equal(fadesBetween(dark, compile({}, 'light')), true)
  assert.equal(fadesBetween(dark, compile({ accent: 'custom', accentCustom: '#ff8800' })), true)
})

test('nothing changing, or a change of shape, does not fade', () => {
  const base = compile({})
  assert.equal(fadesBetween(base, compile({})), false)
  assert.equal(fadesBetween(base, compile({ corners: 'square' })), false)
  assert.equal(fadesBetween(base, compile({ interfaceScale: 120 })), false)
  assert.equal(fadesBetween(base, compile({ messageSize: 18 })), false)
  assert.equal(fadesBetween(base, compile({ density: 'compact' })), false)
})

test('each shape setting on its own blocks the fade', () => {
  const base = compile({})
  assert.equal(fadesBetween(base, compile({ messageLayout: 'irc' })), false)
  assert.equal(fadesBetween(base, compile({ font: 'inter' })), false)
  assert.equal(fadesBetween(base, compile({ groupSpacing: 12 })), false)
  // The radius alone, with the corner attribute unchanged.
  const sameAttrs = { ...base, css: base.css.replace('--radius: 8px', '--radius: 3px') }
  assert.notEqual(sameAttrs.css, base.css)
  assert.equal(fadesBetween(base, sameAttrs), false)
})

test('an attribute-only or custom-CSS change fades', () => {
  const base = compile({})
  assert.equal(fadesBetween(base, { ...base, attrs: { ...base.attrs, 'data-scheme': 'x' } }), true)
  assert.equal(fadesBetween(base, { ...base, userCss: '.a { color: red }' }), true)
  assert.equal(fadesBetween({ ...base, userCss: '' }, base), false)
})

test('a colour change together with a change of shape does not fade', () => {
  assert.equal(fadesBetween(compile({}), compile({ corners: 'square' }, 'light')), false)
})

test('a fade needs a quiet moment since the last one', () => {
  assert.equal(quietSince(undefined, 10), true)
  assert.equal(quietSince(1000, 1000 + FADE_QUIET_MS - 1), false)
  assert.equal(quietSince(1000, 1000 + FADE_QUIET_MS), true)
})
