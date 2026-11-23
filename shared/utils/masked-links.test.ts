import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { markdownToIrc, textOutsideCode } from './irc'
import { messageMediaLinks, messageMediaText } from './link-media'
import { maskedLinks, messagePieces } from './masked-links'

/** What a reader sees, and where each link goes. */
function shown(text: string) {
  const pieces = messagePieces(text)
  return {
    text: pieces
      .map((piece) =>
        piece.kind === 'link' ? piece.runs.map((run) => run.text).join('') : piece.run.text,
      )
      .join(''),
    targets: pieces.flatMap((piece) => (piece.kind === 'link' ? [piece.href] : [])),
  }
}

/**
 * The shared cases: the text as typed in the composer, the visible text, and the masked link's
 * target (none when nothing masks). Ordinary links in the visible text stay ordinary links.
 */
const cases: [typed: string, visible: string, target: string | null][] = [
  // 1. Absolute http, https and mailto addresses mask.
  ['[docs](https://example.com/docs)', 'docs', 'https://example.com/docs'],
  ['see [the site](http://example.com) now', 'see the site now', 'http://example.com'],
  ['[mail me](mailto:me@example.com)', 'mail me', 'mailto:me@example.com'],
  ['[a](https://a.test) and [b](https://b.test)', 'a and b', 'https://a.test'],
  // Anything else stays as typed.
  ['[x](javascript:alert(1))', '[x](javascript:alert(1))', null],
  ['[x](ftp://example.com)', '[x](ftp://example.com)', null],
  ['[x](/relative/path)', '[x](/relative/path)', null],
  ['[x](example.com)', '[x](example.com)', null],
  ['[x](https://)', '[x](https://)', null],
  ['[x](https://example.com/a b)', '[x](https://example.com/a b)', null],
  ['[](https://example.com)', '[](https://example.com)', null],
  ['[ ](https://example.com)', '[ ](https://example.com)', null],
  ['[x](https://example.com', '[x](https://example.com', null],
  ['[two\nlines](https://example.com)', '[two\nlines](https://example.com)', null],
  // Code spans and blocks stay literal.
  ['`[x](https://example.com)`', '[x](https://example.com)', null],
  ['```\n[x](https://example.com)\n```', '```\n[x](https://example.com)\n```', null],
  // 3. Text that reads as another address shows the real address.
  ['[example.com](https://evil.test/login)', 'https://evil.test/login', null],
  ['[https://bank.test](https://evil.test)', 'https://evil.test', null],
  ['[www.bank.test/login](https://evil.test)', 'https://evil.test', null],
  ['[bank.test](https://bank.test@evil.test)', 'https://bank.test@evil.test', null],
  ['[me@bank.test](mailto:me@evil.test)', 'mailto:me@evil.test', null],
  ['[**bank.test**](https://evil.test)', 'https://evil.test', null],
  // The same host may mask: the text tells the truth.
  ['[example.com](https://example.com/page)', 'example.com', 'https://example.com/page'],
  ['[EXAMPLE.com](https://example.com.)', 'EXAMPLE.com', 'https://example.com.'],
  ['[https://example.com](https://example.com/a)', 'https://example.com', 'https://example.com/a'],
  ['[me@example.com](mailto:me@example.com)', 'me@example.com', 'mailto:me@example.com'],
  // Text that only mentions a domain, or has a dot without a host name, still masks.
  ['[read it on example.com](https://evil.test)', 'read it on example.com', 'https://evil.test'],
  ['[v1.5](https://example.com/releases)', 'v1.5', 'https://example.com/releases'],
  ['[Note: see this](https://example.com)', 'Note: see this', 'https://example.com'],
  // 5. Formatting, nested brackets, escapes, parentheses and spacing.
  ['[**bold** and *it*](https://example.com)', 'bold and it', 'https://example.com'],
  ['[a [b] c](https://example.com)', 'a [b] c', 'https://example.com'],
  ['[a \\] b](https://example.com)', 'a ] b', 'https://example.com'],
  ['[a \\[ b](https://example.com)', 'a [ b', 'https://example.com'],
  ['\\[x](https://example.com)', '\\[x](https://example.com)', null],
  [
    '[Foo](https://en.wikipedia.org/wiki/Foo_(bar))',
    'Foo',
    'https://en.wikipedia.org/wiki/Foo_(bar)',
  ],
  ['([x](https://example.com/a))', '(x)', 'https://example.com/a'],
  ['[x](https://example.com/a).', 'x.', 'https://example.com/a'],
  ['[x] (https://example.com)', '[x] (https://example.com)', null],
  ['[x]', '[x]', null],
]

describe('masked links', () => {
  for (const [typed, visible, target] of cases)
    test(JSON.stringify(typed), () => {
      const wire = markdownToIrc(typed)
      assert.equal(shown(wire).text, visible)
      const masked = messagePieces(wire).find((piece) => piece.kind === 'link' && piece.masked)
      assert.equal(masked?.kind === 'link' ? masked.href : null, target)
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
        href: 'https://x.test',
        label: 'b',
        masked: true,
        runs: [{ text: 'b', bold: true }],
      },
      { kind: 'text', run: { text: ' c', bold: true } },
    ])
  })

  test('a link whose text names another host shows the address as an ordinary link', () => {
    assert.deepEqual(messagePieces('[bank.test](https://evil.test)'), [
      {
        kind: 'link',
        href: 'https://evil.test',
        label: 'https://evil.test',
        masked: false,
        runs: [{ text: 'https://evil.test' }],
      },
    ])
  })

  test('report offsets in the wire text', () => {
    assert.deepEqual(maskedLinks('hi [a](https://x.test)!'), [
      {
        start: 3,
        end: 22,
        textStart: 4,
        textEnd: 5,
        url: 'https://x.test',
        label: 'a',
        masked: true,
      },
    ])
  })
})

describe('masked links in previews and search', () => {
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
      'see  https://x.test   ',
    )
  })

  test('a rendered preview never hides the link', () => {
    const text = '[pic](https://example.com/a.png)'
    assert.equal(messageMediaText(text, new Set(['https://example.com/a.png'])), text)
    assert.equal(
      messageMediaText('https://example.com/a.png', new Set(['https://example.com/a.png'])),
      '',
    )
  })
})
