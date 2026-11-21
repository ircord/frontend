import { toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { tabStops } from '../../utils/focus-dom'
import { floatingContains } from './useFloatingPanel'

const boundaries: HTMLElement[] = []
let locks = 0
let previousOverflow = ''

export function useFocusBoundary(
  panel: Ref<HTMLElement | null>,
  enabled: MaybeRefOrGetter<boolean>,
  options: { modal?: boolean; escape?: () => void } = {},
) {
  watch(
    [panel, () => toValue(enabled)],
    ([root, active], _, cleanup) => {
      if (!root || !active) return
      boundaries.push(root)
      if (options.modal && ++locks === 1) {
        previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
      }
      const current = () => boundaries.at(-1) === root
      let lastFocused: HTMLElement | null = null
      function focus(event: FocusEvent) {
        const target = event.target
        if (!current() || !(target instanceof HTMLElement)) return
        if (root!.contains(target)) lastFocused = target
        else if (!floatingContains(root!, target) && !target.closest('.toast')) {
          const previous =
            lastFocused?.isConnected && !lastFocused.closest('[inert]') ? lastFocused : null
          ;(previous ?? tabStops(root!)[0] ?? root)?.focus({ preventScroll: true })
        }
      }
      function keys(event: KeyboardEvent) {
        if (!current() || event.defaultPrevented) return
        if (event.key === 'Escape' && options.escape) {
          event.preventDefault()
          event.stopPropagation()
          options.escape()
        } else if (event.key === 'Tab') {
          const focused = document.activeElement
          if (focused && !root!.contains(focused) && floatingContains(root!, focused)) return
          const stops = tabStops(root!)
          const from = stops.indexOf(focused as HTMLElement)
          if (from < 0 || (event.shiftKey ? from === 0 : from === stops.length - 1)) {
            event.preventDefault()
            ;(event.shiftKey ? (stops.at(-1) ?? root) : (stops[0] ?? root))?.focus({
              preventScroll: true,
            })
          }
        }
      }
      document.addEventListener('focusin', focus)
      document.addEventListener('keydown', keys)
      cleanup(() => {
        const i = boundaries.indexOf(root)
        if (i >= 0) boundaries.splice(i, 1)
        document.removeEventListener('focusin', focus)
        document.removeEventListener('keydown', keys)
        if (options.modal && --locks === 0) document.body.style.overflow = previousOverflow
      })
    },
    { flush: 'post', immediate: true },
  )
}
