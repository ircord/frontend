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
  /** The offsets of the address between the parentheses. */
  urlStart: number
  urlEnd: number
  /** The address in canonical form, as browsers show it (a non-ASCII host in punycode). */
  url: string
  /** The link text without formatting or escapes. */
  label: string
  /**
   * False when the address has user info or the text names another host: the text then stays
   * as typed and only the address inside it is a link.
   */
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
const linkScheme = /(?:https?|mailto):/iy

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
  // A candidate whose text holds another is an outer link; one holding an outer link is text.
  const inside = (open: number, close: number, prefix: Int32Array) =>
    prefix[close]! - prefix[open + 1]! > 0
  const outers = new Int32Array(length + 1)
  for (let i = 0, c = 0; i < length; i++) {
    const candidate = candidates[c]
    const outer = candidate?.open === i && inside(i, candidate.close, opens)
    if (candidate?.open === i) c++
    outers[i + 1] = outers[i]! + (outer ? 1 : 0)
  }
  const links: MaskedLink[] = []
  let after = 0
  let pending: MaskedLink | undefined
  const flush = () => {
    if (pending) links.push(pending)
    after = Math.max(after, pending ? pending.end - base : 0)
    pending = undefined
  }
  for (const { open, close, urlEnd } of candidates) {
    if (pending && open >= pending.start - base) flush()
    if (open < after || inside(open, close, outers)) continue
    const target = linkTarget(text.slice(close + 2, urlEnd))
    const label = stripFormatting(text.slice(open + 1, close)).replace(/\\([[\]])/g, '$1')
    if (!target || !label.trim()) continue
    const link = {
      start: base + open,
      end: base + urlEnd + 1,
      textStart: base + open + 1,
      textEnd: base + close,
      urlStart: base + close + 2,
      urlEnd: base + urlEnd,
      url: target.url,
      label,
      // User info reads as a host (https://bank.test@evil.test), so it never masks.
      masked: !target.userInfo && !namesOtherHost(label, target.url),
    }
    if (inside(open, close, opens)) {
      // As in CommonMark, the inner link wins. The outer one's text stays text, around the
      // inner link, and its address after `](` is an ordinary link.
      pending = { ...link, start: base + close, textStart: base + close, label: '', masked: false }
      continue
    }
    links.push(link)
    after = urlEnd + 1
  }
  flush()
  return links
}

/** The canonical address, when `raw` is an absolute http, https or mailto address. */
function linkTarget(raw: string) {
  try {
    const url = new URL(raw)
    const valid = url.protocol === 'mailto:' ? !!url.pathname : !!url.hostname
    return valid ? { url: url.href, userInfo: !!(url.username || url.password) } : undefined
  } catch {
    return undefined
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
/** Characters that can belong to an address word; anything else separates words. */
const notAddress = /[^\p{L}\p{N}\p{M}.\-@:/_]+/u
const wordEdges = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

/**
 * The words of link text that could name an address. Look-alike characters become their plain
 * forms (NFKC, and the dots that host names accept), and invisible characters are dropped.
 */
function addressWords(label: string) {
  return label
    .normalize('NFKC')
    .replace(/[。．｡]/g, '.')
    .replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, '')
    .split(notAddress)
    .map((word) => word.replace(wordEdges, ''))
    .filter(Boolean)
}

/** The host a word names: a scheme address, an IP address or a dotted host name. */
function wordHost(word: string): string | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:\/\/|mailto:)/i.test(word)) return urlHost(word)
  // Only literals that parse are addresses: 12:30:45 is a time.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(word)) return hostName(word) || undefined
  if (/^[\da-f]*:[\da-f]*:[\da-f:.]*$/i.test(word)) return hostName(`[${word}]`) || undefined
  const match = domainText.exec(word)
  return match ? hostName(match[1]!) : undefined
}

/**
 * Whether any word of the link text reads as an address or a domain whose host is not the
 * link's host. Hosts compare as browsers compare them: lower case, punycode, no trailing dot.
 */
function namesOtherHost(label: string, url: string) {
  const target = urlHost(url)
  return addressWords(label).some((word) => {
    const host = wordHost(word)
    return host !== undefined && (!host || host !== target)
  })
}

/**
 * One stretch of formatted text, or one link with the formatted runs it shows. `literal` text
 * is the typed Markdown around an unmasked link: it shows as typed, without further links.
 */
export type MessagePiece =
  | { kind: 'text'; run: FormattedRun; literal?: boolean }
  | { kind: 'link'; href: string; label: string; masked: boolean; runs: FormattedRun[] }

/**
 * Message text as formatted runs, with links gathered into link pieces. A masked link keeps the
 * formatting inside its text and drops the brackets, the address and backslash escapes. An
 * unmasked one keeps its typed text, and only its address is a link.
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
      const [shownStart, shownEnd] = link.masked
        ? [link.textStart, link.textEnd]
        : [link.urlStart, link.urlEnd]
      if (at < shownStart || at >= shownEnd) {
        // Masked: the brackets and the address are hidden. Unmasked: they show as typed.
        const to = Math.min(end, at < shownStart ? shownStart : link.end)
        if (!link.masked) pieces.push({ kind: 'text', run: slice(to), literal: true })
        at = to
        continue
      }
      if (!open) {
        open = {
          kind: 'link',
          href: link.url,
          label: link.masked ? link.label : link.url,
          masked: link.masked,
          runs: [],
        }
        pieces.push(open)
      }
      const to = Math.min(end, shownEnd)
      const shown = slice(to)
      if (link.masked) shown.text = shown.text.replace(/\\([[\]])/g, '$1')
      if (shown.text) open.runs.push(shown)
      at = to
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

/** Text with each link as its text, followed by its address when it is not masked. */
export function maskedLinkLabels(text: string) {
  return replaceMaskedLinks(text, (link) =>
    link.masked ? link.label : `${link.label} ${link.url}`,
  )
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
