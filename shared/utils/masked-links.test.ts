import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { spokenText } from '../read-aloud'
import { markdownToIrc, splitCodeBlocks } from './irc'
import { messageMediaLinks, messageMediaText } from './link-media'
import { maskedLinkLabels, maskedLinks, messagePieces, textOutsideCode } from './masked-links'

/** The case list both clients share, byte for byte. */
const cases: Case[] = JSON.parse(
  readFileSync(new URL('./masked-links.json', import.meta.url), 'utf8'),
)

type Case = {
  name: string
  /** The message text as it travels on IRC, formatting codes included. */
  input: string
  /** What a reader sees: fenced blocks show their code, links their text. */
  visible: string
  /** Where each masked link opens, in canonical form. */
  targets: string[]
  /** The address of a link that is not masked, shown as an ordinary link. */
  ordinary: string | null
  reason: string
}

/** What a reader sees, where masked links go, and which links stay ordinary. */
function shown(text: string) {
  let visible = ''
  const targets: string[] = []
  const ordinary: string[] = []
  for (const segment of splitCodeBlocks(text)) {
    if (segment.kind === 'code') {
      visible += segment.code
      continue
    }
    for (const piece of messagePieces(segment.raw)) {
      if (piece.kind === 'text') visible += piece.run.text
      else {
        visible += piece.runs.map((run) => run.text).join('')
        ;(piece.masked ? targets : ordinary).push(piece.href)
      }
    }
  }
  return { visible, targets, ordinary: ordinary[0] ?? null }
}

/** The case list both clients share. */
describe('masked links: shared cases', () => {
  for (const item of cases)
    test(`${item.name}: ${item.reason}`, () => {
      assert.deepEqual(shown(item.input), {
        visible: item.visible,
        targets: item.targets,
        ordinary: item.ordinary,
      })
    })
})

/** Further cases this client checks, typed in the composer. */
const typed: [input: string, visible: string, target: string | null][] = [
  ['`[x](https://example.com)`', '[x](https://example.com)', null],
  ['`[`x](https://example.com)', '[x](https://example.com)', null],
  ['[**bank.test**](https://evil.test)', '[bank.test](https://evil.test)', null],
  ['[bank.test](https://bаnk.test)', '[bank.test](https://bаnk.test)', null],
  ['[192.168.1.1](http://192.168.1.1/admin)', '192.168.1.1', 'http://192.168.1.1/admin'],
  ['[meet at 12:30:45](https://example.com)', 'meet at 12:30:45', 'https://example.com/'],
  ['[see e.g. this](https://example.com)', 'see e.g. this', 'https://example.com/'],
  [
    '[read it on example.com](https://example.com/a)',
    'read it on example.com',
    'https://example.com/a',
  ],
]

describe('masked links: composer text', () => {
  for (const [input, visible, target] of typed)
    test(JSON.stringify(input), () => {
      const result = shown(markdownToIrc(input))
      assert.equal(result.visible, visible)
      assert.deepEqual(result.targets, target ? [target] : [])
    })

  test('travel on the wire as typed, apart from inline formatting', () => {
    assert.equal(
      markdownToIrc('[docs](https://example.com/a_b_)'),
      '[docs](https://example.com/a_b_)',
    )
    assert.equal(markdownToIrc('[**b**](https://example.com)'), '[\x02b\x02](https://example.com)')
  })

  test('keep the formatting inside the text', () => {
    const [link] = messagePieces(markdownToIrc('[**bold** *it*](https://example.com)'))
    assert.equal(link?.kind, 'link')
    if (link?.kind !== 'link') return
    assert.deepEqual(link.runs, [
      { text: 'bold', bold: true },
      { text: ' ', bold: false },
      { text: 'it', bold: false, italic: true },
    ])
    assert.equal(link.label, 'bold it')
  })

  test('keep the formatting around a link', () => {
    assert.deepEqual(messagePieces('\x02a [b](https://x.test) c\x02'), [
      { kind: 'text', run: { text: 'a ', bold: true } },
      {
        kind: 'link',
        href: 'https://x.test/',
        label: 'b',
        masked: true,
        runs: [{ text: 'b', bold: true }],
      },
      { kind: 'text', run: { text: ' c', bold: true } },
    ])
  })

  test('a link whose text names another host keeps its text, and links its address', () => {
    assert.deepEqual(messagePieces('[bank.test](https://evil.test)'), [
      { kind: 'text', run: { text: '[bank.test](' }, literal: true },
      {
        kind: 'link',
        href: 'https://evil.test/',
        label: 'https://evil.test/',
        masked: false,
        runs: [{ text: 'https://evil.test' }],
      },
      { kind: 'text', run: { text: ')' }, literal: true },
    ])
  })

  test('open and show a non-ASCII host as browsers do', () => {
    const [link] = messagePieces('[docs](https://bücher.example/a)')
    assert.equal(link?.kind === 'link' && link.href, 'https://xn--bcher-kva.example/a')
  })

  test('report offsets in the wire text', () => {
    assert.deepEqual(maskedLinks('hi [a](https://x.test)!'), [
      {
        start: 3,
        end: 22,
        textStart: 4,
        textEnd: 5,
        urlStart: 7,
        urlEnd: 21,
        url: 'https://x.test/',
        label: 'a',
        masked: true,
      },
    ])
  })

  test('scan crafted text in linear time', () => {
    const inputs = [
      '['.repeat(40000) + '](https://x.test)',
      '[a](https://x.test/'.repeat(4000),
      '[a](('.repeat(10000) + 'https://x.test',
      '[' + '\\'.repeat(40000) + 'x](https://x.test)',
      '[a [b] '.repeat(8000) + '](https://x.test)',
      '[a'.repeat(4000) + '](https://x.test)'.repeat(4000),
    ]
    for (const input of inputs) {
      const started = performance.now()
      maskedLinks(input)
      messagePieces(input)
      assert.ok(performance.now() - started < 500, `${input.slice(0, 20)}… took too long`)
    }
  })
})

describe('masked links in previews, search and plain text', () => {
  test('previews use the real address', () => {
    assert.deepEqual(messageMediaLinks('[pic](https://example.com/a.png)'), [
      'https://example.com/a.png',
    ])
    assert.deepEqual(messageMediaLinks('[https://a.test](https://b.test/x),then'), [
      'https://b.test/x',
    ])
    assert.deepEqual(messageMediaLinks('[Foo](https://en.wikipedia.org/wiki/Foo_(bar))'), [
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ])
    assert.deepEqual(messageMediaLinks(markdownToIrc('`[x](https://example.com/a.png)`')), [])
  })

  test('search and the link list read the address', () => {
    assert.equal(
      textOutsideCode(markdownToIrc('see [it](https://x.test) `code`')),
      'see  https://x.test/   ',
    )
  })

  test('a rendered preview never hides the link', () => {
    const text = '[pic](https://example.com/a.png)'
    assert.equal(messageMediaText(text, new Set(['https://example.com/a.png'])), text)
    assert.equal(
      messageMediaText('https://example.com/a.png', new Set(['https://example.com/a.png'])),
      '',
    )
    // A bare link right before a masked link is still hidden.
    assert.equal(
      messageMediaText(
        'https://a.test/p.png[x](https://b.test/q.png)',
        new Set(['https://a.test/p.png']),
      ),
      '[x](https://b.test/q.png)',
    )
  })

  test('the link list remark reads the link text', () => {
    assert.equal(maskedLinkLabels('see [docs](https://x.test) here'), 'see docs here')
    assert.equal(maskedLinkLabels('[bank.test](https://evil.test)'), 'bank.test https://evil.test/')
  })

  test('read aloud says the link text, then where it goes', () => {
    assert.equal(
      spokenText({ sender: 'a', text: 'see [the docs](https://example.com/docs) now' }),
      'a: see the docs a link to example.com now',
    )
  })
})
