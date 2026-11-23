// Draws Mermaid diagrams as pictures. Mermaid loads the first time a diagram is near the viewport,
// and only the app configures it: the source check (shared/utils/diagram.ts) removes a diagram's
// own configuration first. The result is shown as an <img>, which can run no script, load
// nothing and cannot style the page.
import type { Mermaid } from 'mermaid'
import { diagramSource, maxDiagramBytes, maxDiagramEdges } from '../../shared/utils/diagram'

/** Literal colours: Mermaid computes its palette from them and cannot read CSS variables. */
export type DiagramTheme = {
  dark: boolean
  background: string
  surface: string
  border: string
  text: string
  muted: string
  /** Series colours for pie slices and git branches, the accent first. */
  series: string[]
}

export type DiagramPicture = { url: string; width: number; height: number }

/** The page's web fonts are not available inside a picture, so measuring and drawing share one. */
const fontFamily = 'system-ui, sans-serif'
/** Configuration keys a diagram could never set, even if one got past the source check. */
const secure = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
  'themeCSS',
  'theme',
  'themeVariables',
  'fontFamily',
  'htmlLabels',
  'look',
  'layout',
]
const cacheSize = 50

let library: Promise<Mermaid> | undefined
/** Mermaid keeps global state while it draws, so diagrams are drawn one at a time. */
let queue: Promise<unknown> = Promise.resolve()
let sequence = 0
const cache = new Map<string, Promise<DiagramPicture | null>>()

function load() {
  if (!library) {
    library = import('mermaid').then((module) => module.default)
    // A failed import (offline before the first diagram) may succeed later.
    library.catch(() => (library = undefined))
  }
  return library
}

function configure(mermaid: Mermaid, theme: DiagramTheme) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    suppressErrorRendering: true,
    maxTextSize: maxDiagramBytes,
    maxEdges: maxDiagramEdges,
    theme: 'base',
    darkMode: theme.dark,
    fontFamily,
    themeVariables: {
      darkMode: theme.dark,
      fontFamily,
      background: theme.background,
      primaryColor: theme.surface,
      primaryTextColor: theme.text,
      primaryBorderColor: theme.border,
      secondaryColor: theme.background,
      tertiaryColor: theme.background,
      lineColor: theme.muted,
      edgeLabelBackground: theme.background,
      textColor: theme.text,
      noteBkgColor: theme.surface,
      noteTextColor: theme.text,
      noteBorderColor: theme.border,
      pieStrokeColor: theme.border,
      pieOuterStrokeColor: theme.border,
      ...Object.fromEntries(
        theme.series.flatMap((colour, index) => [
          [`pie${index + 1}`, colour],
          [`git${index}`, colour],
        ]),
      ),
    },
    secure,
  })
}

/** A well-formed SVG document that knows its own size, from Mermaid's HTML-flavoured string. */
function standalone(svg: string) {
  const element = new DOMParser().parseFromString(svg, 'text/html').body.querySelector('svg')
  if (!element) return null
  const box = (element.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (box.length !== 4 || !box.every(Number.isFinite) || box[2]! <= 0 || box[3]! <= 0) return null
  const [width, height] = [Math.ceil(box[2]!), Math.ceil(box[3]!)]
  element.setAttribute('width', String(width))
  element.setAttribute('height', String(height))
  element.removeAttribute('style')
  return { markup: new XMLSerializer().serializeToString(element), width, height }
}

async function draw(source: string, theme: DiagramTheme): Promise<DiagramPicture | null> {
  const mermaid = await load()
  configure(mermaid, theme)
  const { svg } = await mermaid.render(`message-diagram-${++sequence}`, source)
  const picture = standalone(svg)
  if (!picture) return null
  const url = URL.createObjectURL(new Blob([picture.markup], { type: 'image/svg+xml' }))
  return { url, width: picture.width, height: picture.height }
}

function remember(key: string, picture: Promise<DiagramPicture | null>) {
  cache.set(key, picture)
  while (cache.size > cacheSize) {
    const [oldest, evicted] = cache.entries().next().value!
    cache.delete(oldest)
    void evicted.then((value) => value && URL.revokeObjectURL(value.url))
  }
}

/**
 * The diagram as a picture, or null when the message should show its source: refused by the
 * source check, over a limit, not a diagram Mermaid knows, or Mermaid failed to load.
 */
export function renderDiagram(code: string, theme: DiagramTheme): Promise<DiagramPicture | null> {
  const source = diagramSource(code)
  if (source === null) return Promise.resolve(null)
  const key = JSON.stringify([source, theme])
  const cached = cache.get(key)
  if (cached) {
    // Recently used entries are evicted last.
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  const picture = queue.then(() => draw(source, theme)).catch(() => null)
  queue = picture
  remember(key, picture)
  // A failed import is not remembered, so the next diagram tries again.
  void picture.then((value) => {
    if (value === null && library === undefined) cache.delete(key)
  })
  return picture
}
