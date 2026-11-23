import {
  formattingRunsAt,
  parseFormatting,
  splitCodeBlocks,
  stripFormatting,
  type FormattedRun,
} from './irc'

/**
 * Markdown masked links, `[text](url)`, as message text shows them. The message travels on IRC
 * exactly as typed, so plain IRC clients read the Markdown; IRCord shows `text` as a link to
 * `url`. Only absolute http, https and mailto addresses mask. Text that names another address
 * would hide where the link goes, so the link then shows the real address instead. Brackets
 * inside code (fenced blocks and IRC monospace) stay literal.
 */
export type MaskedLink = {
  /** The offsets of `[` and one past `)` in the text. */
  start: number
  end: number
  /** The offsets of the link text between the brackets. */
  textStart: number
  textEnd: number
  url: string
  /** The address as shown to people: `url`, with a non-ASCII web host in punycode. */
  address: string
  /** The link text without formatting or escapes. */
  label: string
  /** False when the text names another address: the link then shows `address` itself. */
  masked: boolean
}

/** Addresses longer than this are left as typed, which keeps scanning linear. */
const maxAddress = 2048

/** The masked links in message text, in order. Linear in the length of the text. */
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

// eslint-disable-next-line no-control-regex -- spaces and control characters end an address
const addressEnd = /[\s\x00-\x1f\x7f<>"]/
const linkScheme = /(?:https?:\/\/|mailto:)/iy

function scanLinks(text: string, base: number) {
  const length = text.length
  // One forward pass each: monospace (code), backslash escapes, bracket and parenthesis pairs.
  const code = new Uint8Array(length)
  const escaped = new Uint8Array(length)
  const bracketClose = new Int32Array(length).fill(-1)
  const parenClose = new Int32Array(length).fill(-1)
  const brackets: number[] = []
  const parens: number[] = []
  let mono = false
  let slashes = 0
  for (let i = 0; i < length; i++) {
    const char = text[i]!
    escaped[i] = slashes % 2
    slashes = char === '\\' ? slashes + 1 : 0
    if (char === '\x11') mono = !mono
    else if (char === '\x0f') mono = false
    else if (mono) code[i] = 1
    // A link stays on one line, and an address has no spaces or control characters.
    if (char === '\n') brackets.length = 0
    else if (!code[i] && !escaped[i]) {
      if (char === '[') brackets.push(i)
      else if (char === ']' && brackets.length) bracketClose[brackets.pop()!] = i
    }
    if (addressEnd.test(char)) parens.length = 0
    else if (char === '(') parens.push(i)
    else if (char === ')' && parens.length) parenClose[parens.pop()!] = i
  }
  // Candidates: `[…]` followed at once by `(…)` that starts with a link scheme.
  const candidates: { open: number; close: number; urlEnd: number }[] = []
  const opens = new Int32Array(length + 1)
  for (let open = 0; open < length; open++) {
    opens[open + 1] = opens[open]!
    const close = bracketClose[open]!
    if (close < 0 || text[close + 1] !== '(') continue
    const urlEnd = parenClose[close + 1]!
    linkScheme.lastIndex = close + 2
    if (urlEnd < 0 || urlEnd - close - 2 > maxAddress || !linkScheme.test(text)) continue
    candidates.push({ open, close, urlEnd })
    opens[open + 1]!++
  }
  const links: MaskedLink[] = []
  let after = 0
  for (const { open, close, urlEnd } of candidates) {
    // As in CommonMark, a link inside the text of another wins, and links never overlap.
    if (open < after || opens[close]! - opens[open + 1]! > 0) continue
    const url = linkTarget(text.slice(close + 2, urlEnd))
    const label = stripFormatting(text.slice(open + 1, close)).replace(/\\([[\]])/g, '$1')
    if (!url || !label.trim()) continue
    links.push({
      start: base + open,
      end: base + urlEnd + 1,
      textStart: base + open + 1,
      textEnd: base + close,
      url,
      address: shownAddress(url),
      label,
      masked: !namesOtherHost(label, url),
    })
    after = urlEnd + 1
  }
  return links
}

/** The address as typed, when it is an absolute http, https or mailto address. */
function linkTarget(raw: string) {
  try {
    const url = new URL(raw)
    if (url.protocol === 'mailto:') return url.pathname ? raw : ''
    return /^https?:$/.test(url.protocol) && url.hostname ? raw : ''
  } catch {
    return ''
  }
}

/** A web address whose host is not ASCII shows as browsers show it, in punycode. */
function shownAddress(raw: string) {
  // eslint-disable-next-line no-control-regex -- any character outside ASCII in the host
  if (!/^https?:\/\/[^/?#]*[^\x00-\x7f]/i.test(raw)) return raw
  try {
    return new URL(raw).href
  } catch {
    return raw
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
  /^(?:[^\s@/]+@)?((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}[\p{L}\p{N}-]*[\p{L}\p{N}])\.?(?::\d+)?(?:[/?#]\S*)?$/iu
const wordEdges = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu

/**
 * Whether any word of the link text reads as an address or a domain whose host is not the
 * link's host. Invisible characters are ignored, and punctuation around a word is not part of it.
 */
function namesOtherHost(label: string, url: string) {
  const target = urlHost(url)
  for (const word of label.replace(/\p{Cf}/gu, '').split(/\s+/)) {
    let host: string
    if (/^[\p{P}\p{S}]*(?:[a-z][a-z\d+.-]*:\/\/|mailto:)/iu.test(word)) {
      const address = word.replace(/^[\p{P}\p{S}]+/u, '').replace(/[)\]>"'.,;:!?]+$/, '')
      host = urlHost(address)
    } else {
      const match = domainText.exec(word.replace(wordEdges, ''))
      if (!match) continue
      host = hostName(match[1]!)
    }
    if (!host || host !== target) return true
  }
  return false
}

/** One stretch of formatted text, or one link with the formatted runs it shows. */
export type MessagePiece =
  | { kind: 'text'; run: FormattedRun }
  | {
      kind: 'link'
      href: string
      address: string
      label: string
      masked: boolean
      runs: FormattedRun[]
    }

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
          address: link.address,
          label: link.masked ? link.label : link.address,
          masked: link.masked,
          runs: link.masked ? [] : [{ ...run, text: link.address }],
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

/** Text with each masked link replaced. Formatting codes inside a link go with it. */
export function replaceMaskedLinks(text: string, replace: (link: MaskedLink) => string) {
  const links = maskedLinks(text)
  if (!links.length) return text
  let out = ''
  let at = 0
  for (const link of links) {
    out += text.slice(at, link.start) + replace(link)
    at = link.end
  }
  return out + text.slice(at)
}

/** Text as a reader sees it: each masked link as its text, or as its address when unmasked. */
export function maskedLinkLabels(text: string) {
  return replaceMaskedLinks(text, (link) => (link.masked ? link.label : link.address))
}

/**
 * Text outside code (fenced blocks and IRC monospace), e.g. for finding links to preview. A
 * masked link `[text](url)` reads as its address. A link is never inside monospace and its
 * address holds no formatting codes, so the monospace state is the same on both sides of it.
 */
export function textOutsideCode(text: string) {
  return splitCodeBlocks(replaceMaskedLinks(text, (link) => ` ${link.url} `))
    .map((segment) =>
      segment.kind === 'code'
        ? ' '
        : parseFormatting(segment.raw)
            .map((run) => (run.mono ? ' ' : run.text))
            .join(''),
    )
    .join('')
}
