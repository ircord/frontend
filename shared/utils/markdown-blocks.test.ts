import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { messageBlocks, type MessageBlock } from './blocks'
import { stripFormatting } from './irc'
import type { MessageList } from './lists'

// The cases in markdown-blocks.json are shared with the other IRCord clients: every client must
// split the same wire text into the same blocks.
interface Case {
  name: string
  text: string
  continuesLine?: boolean
  blocks: unknown[]
}
const cases = JSON.parse(
  readFileSync(new URL('./markdown-blocks.json', import.meta.url), 'utf8'),
) as Case[]

/** A list as the shared cases write it: formatting codes removed, `checked` only on task items. */
function listShape(list: MessageList): unknown {
  return {
    kind: 'list',
    ordered: list.ordered,
    start: list.start,
    items: list.items.map((item) => ({
      text: stripFormatting(item.text),
      ...(item.checked === undefined ? {} : { checked: item.checked }),
      children: item.children.map(listShape),
    })),
  }
}

/** A block as the shared cases write it. */
function shape(block: MessageBlock): unknown {
  switch (block.kind) {
    case 'text':
      return { kind: 'text', text: stripFormatting(block.text) }
    case 'code':
      return { kind: 'code', ...(block.lang ? { lang: block.lang } : {}), code: block.code }
    case 'quote':
      return { kind: 'quote', blocks: block.blocks.map(shape) }
    case 'list':
      return listShape(block.list)
    case 'table':
      return {
        kind: 'table',
        align: block.align,
        header: block.header.map(stripFormatting),
        rows: block.rows.map((row) => row.map(stripFormatting)),
      }
    case 'heading':
      return { kind: 'heading', level: block.level, text: stripFormatting(block.text) }
    case 'rule':
      return { kind: 'rule' }
  }
}

describe('Markdown blocks in message text', () => {
  test('the shared cases are all loaded', () => {
    assert.equal(cases.length, 36)
  })
  for (const { name, text, continuesLine, blocks } of cases) {
    test(name, () => {
      const got = messageBlocks(text, { continuesLine }).map(shape)
      assert.deepEqual(JSON.parse(JSON.stringify(got)), blocks)
    })
  }

  test('a cell keeps its formatting codes for the renderer', () => {
    const [table] = messageBlocks('| \x02bold\x02 |\n|---|\n| \x1dit\x1d |')
    assert.deepEqual(table, {
      kind: 'table',
      align: ['left'],
      header: ['\x02bold\x02'],
      rows: [['\x1dit\x1d']],
    })
  })
})
