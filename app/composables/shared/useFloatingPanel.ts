import { nextTick, shallowRef, useId, watch, type InjectionKey, type Ref } from 'vue'
import { elementOf, tabStops } from '../../utils/focus-dom'

export type PanelSide = 'top' | 'right' | 'bottom' | 'left'
export type PanelAlign = 'start' | 'center' | 'end'
export type PanelEvent = CustomEvent<{ originalEvent?: Event }>
export type PanelEvents = {
  (
    type:
      'openAutoFocus' | 'closeAutoFocus' | 'pointerDownOutside' | 'focusOutside' | 'escapeKeyDown',
    event: PanelEvent,
  ): void
}

export function floatingRoot(open: Ref<boolean>) {
  const anchor = shallowRef<HTMLElement | null>(null)
  return {
    id: useId(),
    open,
    anchor,
    edge: shallowRef<'first' | 'last'>('first'),
    setAnchor: (value: unknown) => {
      anchor.value = elementOf(value)
    },
  }
}

export type FloatingRoot = ReturnType<typeof floatingRoot>
export const popoverKey: InjectionKey<FloatingRoot> = Symbol('popover')

export function panelTrigger(root: FloatingRoot, kind: 'dialog' | 'menu') {
  function onClick(event: MouseEvent) {
    root.setAnchor(event.currentTarget)
    root.edge.value = 'first'
    root.open.value = !root.open.value
  }
  function onKeydown(event: KeyboardEvent) {
    if (kind === 'dialog' || !['ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    root.setAnchor(event.currentTarget)
    root.edge.value = event.key === 'ArrowUp' ? 'last' : 'first'
    root.open.value = true
  }
  return {
    'aria-haspopup': kind,
    'aria-expanded': root.open.value,
    'aria-controls': root.open.value ? root.id : undefined,
    'data-state': root.open.value ? 'open' : 'closed',
    onClick,
    onKeydown,
  }
}

type Layer = { root: FloatingRoot; panel: HTMLElement }
const layers: Layer[] = []

/** Include teleported descendants of a dialog or menu when checking its focus boundary. */
export function floatingContains(root: HTMLElement, target: Node): boolean {
  if (root.contains(target)) return true
  return layers.some(({ root: owner, panel }) => {
    const anchor = owner.anchor.value
    return anchor && panel !== root && panel.contains(target) && floatingContains(root, anchor)
  })
}

export function panelEvent(target: HTMLElement, originalEvent?: Event): PanelEvent {
  // Consumers use target to autofocus a particular child and may veto dismissal.
  const event = new CustomEvent('panel', { cancelable: true, detail: { originalEvent } })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

function place(
  bounds: DOMRect,
  width: number,
  height: number,
  side: PanelSide,
  align: PanelAlign,
  gap: number,
  padding: number,
  rtl: boolean,
) {
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const
  const space = {
    top: bounds.top,
    bottom: innerHeight - bounds.bottom,
    left: bounds.left,
    right: innerWidth - bounds.right,
  }
  const vertical = side === 'top' || side === 'bottom'
  const size = vertical ? height : width
  if (space[side] < size + gap + padding && space[opposite[side]] > space[side])
    side = opposite[side]
  const x = side === 'left' ? bounds.left - width - gap : bounds.right + gap
  const y = side === 'top' ? bounds.top - height - gap : bounds.bottom + gap
  const start = vertical ? (rtl ? bounds.right - width : bounds.left) : bounds.top
  const end = vertical ? (rtl ? bounds.left : bounds.right - width) : bounds.bottom - height
  const cross = align === 'start' ? start : align === 'end' ? end : (start + end) / 2
  const clamp = (value: number, limit: number) =>
    Math.max(padding, Math.min(value, limit - padding))
  const available = vertical ? space[side] - gap - padding : innerHeight - 2 * padding
  return {
    left: `${clamp(vertical ? cross : x, innerWidth - width)}px`,
    top: `${clamp(vertical ? y : cross, innerHeight - Math.min(height, Math.max(64, available)))}px`,
    '--panel-available-height': `${Math.max(64, available)}px`,
    '--panel-trigger-width': `${bounds.width}px`,
  }
}

export function useFloatingPanel(
  root: FloatingRoot,
  options: {
    side?: PanelSide
    align?: PanelAlign
    sideOffset?: number
    collisionPadding?: number
  },
  emit: PanelEvents,
  focusInitial?: (panel: HTMLElement) => void,
) {
  const panel = shallowRef<HTMLElement | null>(null)
  const style = shallowRef<Record<string, string>>({ visibility: 'hidden' })
  watch(
    panel,
    (node, _, cleanup) => {
      if (!node) return
      const layer = { root, panel: node }
      layers.push(layer)
      let active = true
      let outside = false
      let frame = 0
      function update() {
        const anchor = root.anchor.value
        if (!anchor?.isConnected || !node?.isConnected) return
        const bounds = anchor.getBoundingClientRect()
        node.style.setProperty('--panel-trigger-width', `${bounds.width}px`)
        const { width, height } = node.getBoundingClientRect()
        style.value = place(
          bounds,
          width,
          height,
          options.side ?? 'bottom',
          options.align ?? 'start',
          options.sideOffset ?? 4,
          options.collisionPadding ?? 8,
          getComputedStyle(anchor).direction === 'rtl',
        )
      }
      function schedule() {
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0
            update()
          })
      }
      function handleOutside(event: Event) {
        const top = layers.at(-1)
        const anchor = top?.root.anchor.value
        const focus = event.type === 'focusin'
        // A press outside the entire menu dismisses its parent and submenu together.
        const outsideBranch = !focus && anchor && node && floatingContains(node, anchor)
        if (
          !node ||
          (top !== layer && !outsideBranch) ||
          !(event.target instanceof Node) ||
          root.anchor.value?.contains(event.target) ||
          floatingContains(node, event.target)
        )
          return
        const request = panelEvent(node, event)
        emit(focus ? 'focusOutside' : 'pointerDownOutside', request)
        if (request.defaultPrevented) return
        outside = true
        root.open.value = false
      }
      function escape(event: KeyboardEvent) {
        if (!node || layers.at(-1) !== layer || event.key !== 'Escape') return
        const request = panelEvent(node, event)
        emit('escapeKeyDown', request)
        if (request.defaultPrevented) return
        event.preventDefault()
        event.stopPropagation()
        root.open.value = false
      }
      const observer = new ResizeObserver(schedule)
      observer.observe(node)
      const stopObservingAnchor = watch(
        root.anchor,
        (anchor, previous) => {
          if (previous) observer.unobserve(previous)
          if (anchor) observer.observe(anchor)
          schedule()
        },
        { flush: 'post', immediate: true },
      )
      window.addEventListener('resize', schedule)
      window.addEventListener('scroll', schedule, { passive: true, capture: true })
      document.addEventListener('pointerdown', handleOutside, true)
      document.addEventListener('focusin', handleOutside)
      document.addEventListener('keydown', escape, true)
      update()
      void nextTick(() => {
        if (!active) return
        const request = panelEvent(node)
        emit('openAutoFocus', request)
        if (!request.defaultPrevented) {
          if (focusInitial) focusInitial(node)
          else
            (node.querySelector<HTMLElement>('[autofocus]') ?? tabStops(node)[0] ?? node).focus({
              preventScroll: true,
            })
        }
      })
      cleanup(() => {
        active = false
        const i = layers.indexOf(layer)
        if (i >= 0) layers.splice(i, 1)
        cancelAnimationFrame(frame)
        stopObservingAnchor()
        observer.disconnect()
        window.removeEventListener('resize', schedule)
        window.removeEventListener('scroll', schedule, true)
        document.removeEventListener('pointerdown', handleOutside, true)
        document.removeEventListener('focusin', handleOutside)
        document.removeEventListener('keydown', escape, true)
        style.value = { visibility: 'hidden' }
        void nextTick(() => {
          if (root.open.value) return
          const request = panelEvent(node)
          emit('closeAutoFocus', request)
          const focused = document.activeElement
          if (
            !request.defaultPrevented &&
            !outside &&
            (!focused || focused === document.body || node.contains(focused))
          )
            root.anchor.value?.focus({ preventScroll: true })
        })
      })
    },
    { flush: 'post' },
  )
  return { panel, style }
}
