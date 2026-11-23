// Runs inside the hidden diagram frame (app/utils/mermaid.ts), never in the page itself. The
// frame's own policy allows scripts from this site and inline styles, and nothing else, so
// whatever Mermaid lays out here cannot load an image, a font or a stylesheet from anywhere.
import mermaid from 'mermaid'

let sequence = 0
const frame = window as Window & {
  drawDiagram?: (source: string, config: string) => Promise<string>
}
/** Draws one diagram with the page's configuration (JSON) and returns its SVG markup. */
frame.drawDiagram = async (source, config) => {
  mermaid.initialize(JSON.parse(config))
  const { svg } = await mermaid.render(`diagram-${++sequence}`, source)
  return svg
}
document.dispatchEvent(new Event('diagram-frame-ready'))
