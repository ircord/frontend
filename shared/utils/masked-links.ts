import { formattingRunsAt, splitCodeBlocks, stripFormatting, type FormattedRun } from './irc'

/**
 * Markdown masked links, `[text](url)`, as message text shows them. The message travels on IRC
 * exactly as typed, so plain IRC clients read the Markdown; IRCord shows `text` as a link to
 * `url`. Only absolute http, https and mailto addresses mask. Text that itself reads as an
 * address for another host would hide where the link goes, so it shows the real address
 * instead. Brackets inside code (fenced blocks and IRC monospace) stay literal.
 */
export type MaskedLink = {
  /** The offsets of `[` and one past `)` in the text. */
  start: number
  end: number
  /** The offsets of the link text between the brackets. */
  textStart: number
  textEnd: number
  url: string
  /** The link text without formatting or escapes. */
  label: string
  /** False when the text names another address: the link then shows `url` itself. */
  masked: boolean
}

/** The masked links in message text, in order. */
export function maskedLinks(text: string): MaskedLink[] {
  if (!text.includes('](')) return []
  const links: MaskedLink[] = []
  let offset = 0
  for (const segment of splitCodeBlocks(text)) {
    if (segment.kind === 'text') links.push(...scanLinks(segment.raw, offset))
    offset += segment.raw.length
  }
  return links
}

function scanLinks(text: string, base: number) {
  // Characters inside IRC monospace are code. Formatting codes themselves are never code.
  const code = new Uint8Array(text.length)
  let mono = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\x11') mono = !mono
    else if (text[i] === '\x0f') mono = false
    else if (mono) code[i] = 1
  }
  const links: MaskedLink[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '[' || code[i] || escaped(text, i)) continue
    const close = closingBracket(text, i, code)
    if (close < 0 || text[close + 1] !== '(') continue
    const urlEnd = closingParen(text, close + 1)
    if (urlEnd < 0) continue
    const url = linkTarget(text.slice(close + 2, urlEnd))
    const label = stripFormatting(text.slice(i + 1, close)).replace(/\\([[\]])/g, '$1')
    if (!url || !label.trim()) continue
    links.push({
      start: base + i,
      end: base + urlEnd + 1,
      textStart: base + i + 1,
      textEnd: base + close,
      url,
      label,
      masked: !namesOtherHost(label.trim(), url),
    })
    i = urlEnd
  }
  return links
}

/** A backslash escapes the next character, unless it is itself escaped. */
function escaped(text: string, at: number) {
  let slashes = 0
  while (at - slashes - 1 >= 0 && text[at - slashes - 1] === '\\') slashes++
  return slashes % 2 === 1
}

/** The `]` that closes the `[` at `open`, counting nested pairs, on the same line. */
function closingBracket(text: string, open: number, code: Uint8Array) {
  let depth = 0
  for (let i = open + 1; i < text.length; i++) {
    const char = text[i]
    if (char === '\n') return -1
    if (code[i] || escaped(text, i)) continue
    if (char === '[') depth++
    else if (char === ']' && depth-- === 0) return i
  }
  return -1
}

/** The `)` that closes the `(` at `open`; balanced pairs belong to the address. */
function closingParen(text: string, open: number) {
  let depth = 0
  for (let i = open + 1; i < text.length; i++) {
    const char = text[i]!
    // eslint-disable-next-line no-control-regex -- spaces and control characters end an address
    if (/[\s\x00-\x1f\x7f<>"]/.test(char)) return -1
    if (char === '(') depth++
    else if (char === ')' && depth-- === 0) return i
  }
  return -1
}

/** The address as typed, when it is an absolute http, https or mailto address. */
function linkTarget(raw: string) {
  if (!/^(?:https?:\/\/|mailto:)/i.test(raw)) return ''
  try {
    const url = new URL(raw)
    if (url.protocol === 'mailto:') return url.pathname ? raw : ''
    return url.hostname ? raw : ''
  } catch {
    return ''
  }
}

/** The host an address names: a web host, or the domain of a mail address. */
function urlHost(raw: string) {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'mailto:') return url.hostname.replace(/\.$/, '')
    return hostName(url.pathname.split('?')[0]!.split('@').pop() ?? '')
  } catch {
    return ''
  }
}

/** A host name in the form browsers compare (lower case, punycode), or '' when it is none. */
function hostName(host: string) {
  try {
    return new URL(`http://${host}`).hostname.replace(/\.$/, '')
  } catch {
    return ''
  }
}

/** A dotted host name such as example.com, with an optional mail user, port and path. */
const domainText =
  /^(?:[^\s@/]+@)?((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}[\p{L}\p{N}-]*)\.?(?::\d+)?(?:[/?#]\S*)?$/iu

/** Whether link text reads as an address or a domain whose host is not the link's host. */
function namesOtherHost(label: string, url: string) {
  let host: string | undefined
  if (/^[a-z][a-z\d+.-]*:\/\/|^mailto:/i.test(label)) host = urlHost(label)
  else {
    const match = domainText.exec(label)
    if (!match) return false
    host = hostName(match[1]!)
  }
  return !host || host !== urlHost(url)
}

/** One stretch of formatted text, or one link with the formatted runs it shows. */
export type MessagePiece =
  | { kind: 'text'; run: FormattedRun }
  | { kind: 'link'; href: string; label: string; masked: boolean; runs: FormattedRun[] }

/**
 * Message text as formatted runs, with masked links gathered into link pieces. A link keeps the
 * formatting inside its text and drops the brackets, the address and backslash escapes.
 */
export function messagePieces(text: string): MessagePiece[] {
  const links = maskedLinks(text)
  const runs = formattingRunsAt(text)
  if (!links.length) return runs.map(({ start: _, ...run }) => ({ kind: 'text', run }))
  const pieces: MessagePiece[] = []
  let index = 0
  let open: (MessagePiece & { kind: 'link' }) | undefined
  for (const { start, ...run } of runs) {
    const end = start + run.text.length
    let at = start
    while (at < end) {
      const link = links[index]
      if (link && at >= link.end) {
        index++
        open = undefined
        continue
      }
      const slice = (to: number) => ({ ...run, text: run.text.slice(at - start, to - start) })
      if (!link || at < link.start) {
        const to = Math.min(end, link?.start ?? end)
        pieces.push({ kind: 'text', run: slice(to) })
        at = to
        continue
      }
      if (!open) {
        open = {
          kind: 'link',
          href: link.url,
          label: link.masked ? link.label : link.url,
          masked: link.masked,
          runs: link.masked ? [] : [{ ...run, text: link.url }],
        }
        pieces.push(open)
      }
      if (link.masked && at >= link.textStart && at < link.textEnd) {
        const to = Math.min(end, link.textEnd)
        const shown = slice(to)
        shown.text = shown.text.replace(/\\([[\]])/g, '$1')
        if (shown.text) open.runs.push(shown)
        at = to
      } else at = Math.min(end, link.masked && at < link.textStart ? link.textStart : link.end)
    }
  }
  return pieces
}

/**
 * Text with each masked link replaced by its address, for finding links to preview, list and
 * search. Monospace and reset codes inside a link are kept, so code after it stays code.
 */
export function linkTargetsText(text: string) {
  const links = maskedLinks(text)
  if (!links.length) return text
  let out = ''
  let at = 0
  for (const link of links) {
    // eslint-disable-next-line no-control-regex -- keep the monospace state across the link
    const codes = text.slice(link.start, link.end).replace(/[^\x0f\x11]/g, '')
    out += `${text.slice(at, link.start)} ${link.url} ${codes}`
    at = link.end
  }
  return out + text.slice(at)
}
