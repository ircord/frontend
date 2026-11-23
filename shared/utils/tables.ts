// Markdown pipe tables in message text. Tables travel on IRC exactly as typed (`| a | b |`), so
// other clients read plain Markdown and every IRCord view renders them from the same text, as
// with lists and fenced code.

export type TableAlign = 'left' | 'center' | 'right'

/** More columns than this is not a table, so hostile input stays small (like `maxListDepth`). */
export const maxTableColumns = 20

/**
 * A row's cells: the line is trimmed, one leading `|` and one trailing unescaped `|` are dropped,
 * it splits at every `|` no backslash escapes (`\|` is a literal pipe), and each cell is trimmed.
 * A line without a `|` is not a row.
 */
export function cells(line: string): string[] | null {
  const text = line.trim()
  if (!text.includes('|')) return null
  const inner = text.replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  return inner.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim())
}

/** The column alignments of a delimiter row (`|:--|:-:|--:|`), or null when the line is not one. */
export function delimiter(line: string): TableAlign[] | null {
  const row = cells(line)
  if (!row) return null
  const out: TableAlign[] = []
  for (const cell of row) {
    if (!/^:?-+:?$/.test(cell)) return null
    if (cell.startsWith(':') && cell.endsWith(':')) out.push('center')
    else if (cell.endsWith(':')) out.push('right')
    else out.push('left')
  }
  return out
}
