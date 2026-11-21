import assert from 'node:assert/strict'
import test from 'node:test'
import { networkGlyph } from './network-glyph'

test('a network name always draws the same icon', () => {
  assert.deepEqual(networkGlyph('Libera.Chat'), networkGlyph(' libera.chat '))
})

test('different network names draw different icons', () => {
  assert.notDeepEqual(networkGlyph('Libera.Chat'), networkGlyph('OFTC'))
})

test('network icons are mirrored and never empty', () => {
  for (const name of ['', 'a', 'EFnet', 'IRCnet', 'Rizon', 'QuakeNet']) {
    const { cells, hue } = networkGlyph(name)
    assert.ok(cells.length > 0)
    assert.ok(hue >= 0 && hue < 360)
    const keys = new Set(cells.map(([column, row]) => `${column}:${row}`))
    for (const [column, row] of cells) assert.ok(keys.has(`${4 - column}:${row}`))
  }
})
