// Draws Mermaid diagrams as pictures, in three layers:
// 1. The source check (shared/utils/diagram.ts) removes a diagram's own configuration and refuses
//    sources that name a resource.
// 2. Mermaid runs in a hidden frame with its own document, scripts and policy
//    (app/workers/diagram-frame.ts), loaded the first time a diagram is near the viewport. The
//    frame's policy allows scripts from this site and inline styles, nothing else, so a way to
//    name a resource that the check does not know still loads nothing while Mermaid lays out.
// 3. The page receives only SVG text and shows it as an <img>, which can run no script, load
//    nothing and cannot style the page.
import { diagramSource, maxDiagramBytes, maxDiagramEdges } from '../../shared/utils/diagram'
import frameScript from '../workers/diagram-frame.ts?worker&url'

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

/** The frame's whole policy, on top of the page's own, which a srcdoc frame inherits. */
const framePolicy = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'"

type DiagramFrame = Window & { drawDiagram?: (source: string, config: string) => Promise<string> }

let frame: Promise<DiagramFrame> | undefined
/** Mermaid keeps global state while it draws, so diagrams are drawn one at a time. */
let queue: Promise<unknown> = Promise.resolve()
const cache = new Map<string, Promise<DiagramPicture | null>>()

function load() {
  if (!frame) {
    frame = new Promise<DiagramFrame>((resolve, reject) => {
      const element = document.createElement('iframe')
      element.setAttribute('aria-hidden', 'true')
      element.tabIndex = -1
      // Laid out (Mermaid measures text) but never seen or reached.
      element.style.cssText =
        'position:fixed;left:-20000px;top:0;width:1600px;height:1200px;border:0;visibility:hidden;pointer-events:none'
      element.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${framePolicy}"><script type="module" src="${frameScript}"></script></head><body></body></html>`
      // Module scripts run before the frame's load event.
      element.addEventListener(
        'load',
        () => {
          const window = element.contentWindow as DiagramFrame | null
          if (window?.drawDiagram) return resolve(window)
          element.remove()
          reject(new Error('The diagram frame did not start.'))
        },
        { once: true },
      )
      document.body.append(element)
    })
    // A failed load (offline before the first diagram) may succeed later.
    frame.catch(() => (frame = undefined))
  }
  return frame
}

function configuration(theme: DiagramTheme) {
  return {
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
  }
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
  const diagrams = await load()
  const svg = await diagrams.drawDiagram!(source, JSON.stringify(configuration(theme)))
  const picture = standalone(String(svg))
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
  // A failed frame load is not remembered, so the next diagram tries again.
  void picture.then((value) => {
    if (value === null && frame === undefined) cache.delete(key)
  })
  return picture
}
