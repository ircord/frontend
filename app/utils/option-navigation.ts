export function nextOption(key: string, available: number[], current: number): number | undefined {
  if (!available.length) return
  if (key === 'Home') return available[0]
  if (key === 'End') return available.at(-1)
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return
  const from = available.indexOf(current)
  if (from < 0) return key === 'ArrowDown' ? available[0] : available.at(-1)
  return available[(from + (key === 'ArrowDown' ? 1 : -1) + available.length) % available.length]
}
