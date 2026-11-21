/**
 * Text emoticons the composer turns into emoji once they stand as a word, as Discord does:
 * “:) ” becomes “🙂 ”. Only faces people commonly type are listed. Forms that also appear in
 * ordinary text (“D:” for a drive, “B)” or “8)” in a list) are left out.
 */
export const emoticons: Readonly<Record<string, string>> = {
  ':)': '🙂',
  ':-)': '🙂',
  '=)': '🙂',
  ':(': '🙁',
  ':-(': '🙁',
  '=(': '🙁',
  ':D': '😄',
  ':-D': '😄',
  '=D': '😄',
  ':P': '😛',
  ':p': '😛',
  ':-P': '😛',
  ':-p': '😛',
  '=P': '😛',
  ';P': '😜',
  ';p': '😜',
  ';-P': '😜',
  ';-p': '😜',
  ':O': '😮',
  ':o': '😮',
  ':-O': '😮',
  ':-o': '😮',
  ';)': '😉',
  ';-)': '😉',
  ':X': '🤐',
  ':x': '🤐',
  ':-X': '🤐',
  ':-x': '🤐',
  '<3': '❤️',
  '</3': '💔',
  ":'(": '😢',
  ":'-(": '😢',
  ':/': '😕',
  ':-/': '😕',
  ':|': '😐',
  ':-|': '😐',
  XD: '😆',
  xD: '😆',
  ':*': '😘',
  ':-*': '😘',
  '>:(': '😠',
  '>:-(': '😠',
}

const alternatives = Object.keys(emoticons)
  .sort((a, b) => b.length - a.length)
  .map((text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
  .join('|')
/** An emoticon that starts the text or follows whitespace, then the whitespace that ends it. */
const typed = new RegExp(`(?:^|\\s)(${alternatives})(\\s)$`)
/** An emoticon at the very end, after whitespace or alone. */
const trailing = new RegExp(`(?:^|\\s)(${alternatives})$`)

/**
 * Whether `index` falls inside code: an open ``` fence (fences open at the start of a line) or an
 * open `inline code` span on the same line.
 */
export function insideCode(text: string, index: number) {
  const before = text.slice(0, index)
  if ((before.match(/(?:^|\n)```/g)?.length ?? 0) % 2) return true
  const line = before.slice(before.lastIndexOf('\n') + 1).replace(/^```/, '')
  return (line.match(/`/g)?.length ?? 0) % 2 === 1
}

export interface EmoticonMatch {
  /** Where the emoticon starts in the text. */
  start: number
  /** The emoticon as typed, without the whitespace after it. */
  text: string
  emoji: string
}

/**
 * The emoticon that whitespace typed at `caret` just finished, if any. Emoticons inside code, a
 * URL or a longer word stay as typed, because they must start the text or follow whitespace.
 */
export function finishedEmoticon(text: string, caret: number): EmoticonMatch | null {
  const match = typed.exec(text.slice(0, caret))
  if (!match) return null
  const start = caret - match[2]!.length - match[1]!.length
  if (insideCode(text, start)) return null
  return { start, text: match[1]!, emoji: emoticons[match[1]!]! }
}

/** The text with an emoticon that ends it (sending finishes the word) turned into its emoji. */
export function convertTrailingEmoticon(text: string) {
  const match = trailing.exec(text)
  if (!match) return text
  const start = text.length - match[1]!.length
  if (insideCode(text, start)) return text
  return text.slice(0, start) + emoticons[match[1]!]!
}
