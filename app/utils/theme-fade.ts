/**
 * When a change of appearance fades. Colours cross-fade as one picture; fonts, sizes, corners and
 * layout change the shape of the page, and a cross-fade of two layouts ghosts the text. A fade
 * also needs a quiet moment: the colour pickers send a change on every drag step.
 */

export interface AppliedAppearance {
  css: string
  attrs: Record<string, string>
  /** A personal theme's custom CSS, written with the rest. */
  userCss?: string
}

/** Declarations that change how big or where things are, not what colour they are. */
const shapeDeclarations = [
  '--font-ui',
  '--interface-scale',
  '--font-message',
  '--font-mono',
  '--message-size',
  '--group-gap',
  '--radius',
  '--radius-large',
]
const shapeAttributes = ['data-layout', 'data-density', 'data-corners']

/** Shorter than this since the last fade began, and the next change is written at once. */
export const FADE_QUIET_MS = 250

const declaration = (css: string, name: string) =>
  new RegExp(`${name}:\\s*([^;}]*)`).exec(css)?.[1]?.trim()

/** Whether going from one applied appearance to the next is a colour-only change. */
export function fadesBetween(previous: AppliedAppearance, next: AppliedAppearance) {
  const reshaped =
    shapeDeclarations.some(
      (name) => declaration(previous.css, name) !== declaration(next.css, name),
    ) || shapeAttributes.some((name) => previous.attrs[name] !== next.attrs[name])
  if (reshaped) return false
  if (previous.css !== next.css || (previous.userCss ?? '') !== (next.userCss ?? '')) return true
  const names = new Set([...Object.keys(previous.attrs), ...Object.keys(next.attrs)])
  return [...names].some((name) => previous.attrs[name] !== next.attrs[name])
}

/** Whether the last fade began long enough ago for another. */
export const quietSince = (startedAt: number | undefined, now: number) =>
  startedAt === undefined || now - startedAt >= FADE_QUIET_MS
