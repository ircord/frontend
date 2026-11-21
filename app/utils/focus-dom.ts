export function elementOf(value: unknown): HTMLElement | null {
  if (value instanceof HTMLElement) return value
  if (value && typeof value === 'object' && '$el' in value && value.$el instanceof HTMLElement)
    return value.$el
  return null
}

/** Elements a reader can reach with Tab, in their normal tab order. */
export function tabStops(root: HTMLElement) {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable="true"]',
    ),
  ]
    .filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        !element.closest('[inert], [hidden]') &&
        element.getClientRects().length &&
        getComputedStyle(element).visibility === 'visible',
    )
    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity))
}
