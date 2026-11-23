// The blocks a message body renders as: fenced code, quotes, Markdown lists and the text between.
import { splitCodeBlocks, stripFormatting } from './irc'
import { splitLists, type ListBlock } from './lists'
import { splitQuotes } from './quotes'
import { cells, delimiter, maxTableColumns, type TableAlign } from './tables'

export type MessageBlock =
  | ListBlock
  | { kind: 'code'; code: string; lang?: string }
  | { kind: 'quote'; blocks: MessageBlock[] }
  | { kind: 'table'; align: TableAlign[]; header: string[]; rows: string[][] }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'rule' }

const headingLine = /^(#{1,6})[ \t]+(\S.*?)[ \t]*$/
const ruleLine = /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/

/**
 * Text outside code and quotes: tables first, then headings and rules, then lists. A table is a
 * header row directly followed by a delimiter row of the same width, then body rows up to the
 * first line without a `|`. Blank lines beside a table, heading or rule are dropped, as the block
 * has its own margin; beside lists and plain text they stay.
 */
function splitRich(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = []
  let pending: string[] = []
  /** A table, heading or rule was just added: the blank lines after it are its own margin. */
  let afterBlock = false
  /** Text before a table, heading or rule ends without its blank lines, for the same reason. */
  const flush = (beforeBlock: boolean) => {
    if (beforeBlock) while (pending.length && !pending.at(-1)!.trim()) pending.pop()
    if (pending.length) blocks.push(...splitLists(pending.join('\n')))
    pending = []
    afterBlock = beforeBlock
  }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (afterBlock && !line.trim()) continue
    const header = cells(line)
    const align = header && i + 1 < lines.length ? delimiter(lines[i + 1]!) : null
    if (header && align && header.length === align.length && header.length <= maxTableColumns) {
      flush(true)
      const rows: string[][] = []
      for (i += 2; i < lines.length; i++) {
        const row = cells(lines[i]!)
        if (!row) break
        rows.push(Array.from(align, (_, column) => row[column] ?? ''))
      }
      i--
      blocks.push({ kind: 'table', align, header, rows })
      continue
    }
    const heading = headingLine.exec(line)
    if (heading) {
      flush(true)
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! })
    } else if (ruleLine.test(line)) {
      flush(true)
      blocks.push({ kind: 'rule' })
    } else {
      afterBlock = false
      pending.push(line)
    }
  }
  flush(false)
  return blocks
}

/** Ordinary one-line prose can render as text without building formatting components. */
export function isPlainMessageText(text: string) {
  // Keep controls, possible links and mentions, fences, block markers and emoji-only lines
  // on the rich path. A conservative match keeps their behavior in one place.
  // eslint-disable-next-line no-control-regex -- IRC formatting codes are control characters.
  if (/[\x00-\x1f:@#`]|^ *(?:>|[-+*] |\d+[.)] )/.test(text)) return false
  return /(?!\p{Extended_Pictographic}|\p{Emoji_Presentation})[\p{L}\p{N}]/u.test(text)
}

/**
 * Splits a message body into blocks. Fenced code comes first, so nothing inside it is a quote or
 * a list; then `> ` quotes, whose contents split again; then tables, headings, rules and lists. A `>>> `
 * quote takes everything after it, code blocks included. The line breaks around a block belong to
 * the block, so the text next to it drops one newline on that side. With `continuesLine` the
 * first line follows other content (an action's nick), so it starts no quote or list.
 */
export function messageBlocks(
  text: string,
  { quotes = true, continuesLine = false } = {},
): MessageBlock[] {
  if (continuesLine) {
    const end = text.indexOf('\n')
    if (end < 0) return [{ kind: 'text', text }]
    const head = text.slice(0, end)
    const rest = messageBlocks(text.slice(end + 1), { quotes })
    const first = rest[0]
    if (first?.kind === 'text')
      return [{ kind: 'text', text: `${head}\n${first.text}` }, ...rest.slice(1)]
    return [{ kind: 'text', text: head }, ...rest]
  }
  const segments = splitCodeBlocks(text)
  const blocks: MessageBlock[] = []
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!
    if (segment.kind === 'code') {
      blocks.push({ kind: 'code', code: stripFormatting(segment.code), lang: segment.lang })
      continue
    }
    let part = segment.raw
    const nextIsCode = segments[index + 1]?.kind === 'code'
    if (segments[index - 1]?.kind === 'code') part = part.replace(/^\n/, '')
    if (nextIsCode) part = part.replace(/\n$/, '')
    if (!quotes) {
      blocks.push(...splitRich(part))
      continue
    }
    for (const piece of splitQuotes(part)) {
      if (piece.kind === 'text') {
        blocks.push(...splitRich(piece.text))
        continue
      }
      let inner = piece.text
      if (piece.rest && nextIsCode) {
        // The rest of the message: the newline trimmed above and every later segment.
        inner += `\n${segments
          .slice(index + 1)
          .map((later) => later.raw)
          .join('')}`
        index = segments.length
      }
      blocks.push({ kind: 'quote', blocks: messageBlocks(inner, { quotes: false }) })
    }
  }
  return blocks
}
