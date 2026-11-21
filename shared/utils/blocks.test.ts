import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { isPlainMessageText } from './blocks'

describe('plain timeline messages', () => {
  test('render ordinary prose without formatting components', () => {
    assert.equal(isPlainMessageText('  Glad to see you! <3 '), true)
    assert.equal(isPlainMessageText('Hej, こんにちは 🌻'), true)
    assert.equal(isPlainMessageText('你好 🌻'), true)
  })

  test('leave formatting and interactive content on the rich path', () => {
    const rich = [
      'https://example.com',
      'irc://irc.example.com',
      '@anyone',
      '#general',
      'hi :sunflower:',
      '🌻 👋',
      'ℹ️',
      '\x02bold',
      '```js\nconsole.log(1)\n```',
      '> quoted text',
      '  - list item',
      '12) numbered item',
      'first line\nsecond line',
    ]
    assert.deepEqual(rich.filter(isPlainMessageText), [])
  })
})
