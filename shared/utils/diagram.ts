// Which fenced code blocks draw as diagrams, and the check a diagram's source passes first.
//
// A diagram is drawn by everyone who reads the message, so its source must not make their browser
// fetch anything: link previews are fetched by the backend for the same reason. The page policy
// allows images from any https host (GIFs, emotes), so it cannot stop a diagram that asks for one,
// and Mermaid's own strict mode lets some requests through while it lays a diagram out in the
// page. This check runs before Mermaid sees the source.

/** Fence languages drawn as diagrams. */
const diagramLanguages = new Set(['mermaid'])

/** Longest diagram source drawn, in UTF-8 bytes; a longer one shows its source. */
export const maxDiagramBytes = 8192

/** Most edges Mermaid lays out: it blocks the page while it works and cannot be interrupted. */
export const maxDiagramEdges = 100

export function isDiagramLanguage(lang?: string) {
  return lang !== undefined && diagramLanguages.has(lang.toLowerCase())
}

/** A leading front-matter block: a title and configuration for the diagram. */
const frontMatter = /^\s*---[ \t]*\n[\s\S]*?\n[ \t]*---[ \t]*(?:\n|$)/
/** `%%{init: ...}%%` and other directives. */
const directive = /%%\{[\s\S]*?\}%%/g
/**
 * Anything that can name a resource: a CSS `url(`, `image-set(` or `@import`, any `scheme://`
 * address, the image and icon entries of an `@{ ... }` node, and backslashes, which CSS reads as
 * escapes (`u\72l(` is `url(`).
 */
const resource =
  /url\s*\(|(?:image-set|cross-fade)\(|(?<![\w-])(?:image|src)\(|@import|:\/\/|\\|@\{[^}]*\b(?:img|icon)\s*:/i

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
  if (text.includes('%%{') || resource.test(text)) return null
  return text.trim() ? text : null
}
