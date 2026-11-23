// Which fenced code blocks draw as diagrams, and the check a diagram's source passes first.
//
// A diagram is drawn by everyone who reads the message, so its source must not make their browser
// fetch anything: link previews are fetched by the backend for the same reason. The page policy
// allows images from any https host (GIFs, emotes), so it cannot stop a diagram that asks for one,
// and Mermaid's own strict mode lets some requests through while it lays a diagram out. This check
// runs before Mermaid sees the source; Mermaid then runs in a frame whose own policy loads nothing
// (app/utils/mermaid.ts), so the check is the first of two layers, not the only one.
//
// The check follows Mermaid's syntax, which grows with new releases. The version is pinned exactly
// for that reason: before raising it, run the hostile diagram corpus in a browser again.

/** Fence languages drawn as diagrams. */
const diagramLanguages = new Set(['mermaid'])

/** Longest diagram source drawn, in UTF-8 bytes; a longer one shows its source. */
export const maxDiagramBytes = 8192

/** Most edges Mermaid lays out: it blocks the page while it works and cannot be interrupted. */
export const maxDiagramEdges = 100

export function isDiagramLanguage(lang?: string): lang is string {
  return lang !== undefined && diagramLanguages.has(lang.toLowerCase())
}

/** A leading front-matter block: a title and configuration for the diagram. */
const frontMatter = /^\s*---[ \t]*\n[\s\S]*?\n[ \t]*---[ \t]*(?:\n|$)/
/** `%%{init: ...}%%` and other directives. */
const directive = /%%\{[\s\S]*?\}%%/g
/**
 * Anything that can name a resource: a CSS `url(`, `image-set(` or `@import`, any `scheme://`
 * address, and backslashes, which CSS reads as escapes (`u\72l(` is `url(`).
 */
const resource = /url\s*\(|(?:image-set|cross-fade)\(|(?<![\w-])(?:image|src)\(|@import|:\/\/|\\/i
/**
 * Node shape data (`A@{ ... }`) is YAML: a key can be quoted or an alias, and a quoted value can
 * hold `}`, so its `img` and `icon` entries cannot be found by position. Any shape data together
 * with either word anywhere in the source is refused.
 */
const shapeImage = (text: string) => /@\{/.test(text) && /\b(?:img|icon)\b/i.test(text)
/** A sequence diagram's `properties` statement can give a participant an icon image. */
const properties = /^[ \t]*properties\b/im

/**
 * The source Mermaid may be given, or null when the message shows the source instead. Front
 * matter and directives are removed, because only the app sets configuration. A source that is
 * over the size limit, could name a resource, or still holds what Mermaid would read as
 * configuration after that, is refused.
 */
export function diagramSource(source: string): string | null {
  if (new TextEncoder().encode(source).length > maxDiagramBytes) return null
  let text = source.replace(/\r\n?/g, '\n').replace(frontMatter, '')
  // A second front-matter block would become the first; Mermaid also reads an unclosed `%%{`.
  if (/^\s*---/.test(text)) return null
  for (let previous = ''; previous !== text;) {
    previous = text
    text = text.replace(directive, '')
  }
  if (text.includes('%%{') || resource.test(text) || shapeImage(text) || properties.test(text))
    return null
  return text.trim() ? text : null
}
