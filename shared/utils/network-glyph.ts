/**
 * A stable generated icon for a network without its own: a mirrored 5×5 pattern and a hue,
 * both taken from the network name, so the same name always draws the same icon.
 */
export interface NetworkGlyph {
  hue: number
  /** Filled cells as [column, row], 0–4. */
  cells: [number, number][]
}

export function networkGlyph(name: string): NetworkGlyph {
  let hash = 2166136261
  for (const char of name.trim().toLowerCase())
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  hash = (hash ^ (hash >>> 16)) >>> 0
  const cells: [number, number][] = []
  // 15 bits fill the left three columns; columns 3 and 4 mirror 1 and 0.
  for (let column = 0; column < 3; column++)
    for (let row = 0; row < 5; row++)
      if (hash & (1 << (column * 5 + row))) {
        cells.push([column, row])
        if (column < 2) cells.push([4 - column, row])
      }
  // An empty pattern would read as a blank tile; fill the centre column instead.
  if (!cells.length) for (let row = 0; row < 5; row++) cells.push([2, row])
  return { hue: (hash >>> 15) % 360, cells }
}
