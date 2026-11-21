<script setup vapor lang="ts">
// Vendored from shadcn-vue’s MessageScroller; styling lives with the timeline's own CSS.
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { SCROLL_KEYS, useMessageScrollerContext } from '../../composables/chat/useMessageScroller'
import { isEditable } from '../../../shared/utils/focus'

const props = withDefaults(defineProps<{ preserveScrollOnPrepend?: boolean }>(), {
  preserveScrollOnPrepend: true,
})

const {
  autoscrolling,
  handleResize,
  scrollableAttr,
  setPreserveScrollOnPrepend,
  setViewportElement,
  syncAfterScroll,
  userPointer,
  userScrollIntent,
} = useMessageScrollerContext()

// A held finger or mouse button (dragging the scrollbar, selecting text) holds automatic
// scrolling until released anywhere. Touch uses touch events: pointers cancel once a pan starts.
// Only the main button holds: a right-click opens a menu and may never report its release.
function onPointerDown(event: PointerEvent) {
  if (event.pointerType !== 'touch' && event.button === 0) userPointer(true)
}
const release = () => userPointer(false)
useEventListener(
  window,
  'pointerup',
  (event: PointerEvent) => {
    if (event.pointerType !== 'touch') release()
  },
  { passive: true },
)
useEventListener(window, 'pointercancel', (event: PointerEvent) => {
  if (event.pointerType !== 'touch') release()
})
// The hold lasts while any finger is still down.
const touchEnded = (event: TouchEvent) => {
  if (!event.touches.length) release()
}
useEventListener(window, 'touchend', touchEnded, { passive: true })
useEventListener(window, 'touchcancel', touchEnded, { passive: true })
useEventListener(window, 'blur', release)

let touchY = 0
let touchStart = { x: 0, y: 0 }
/**
 * Whether this touch scrolls, decided once it has moved 10px. A sideways swipe (reply, drawers)
 * never counts as scrolling, whatever its small vertical drift.
 */
let scrolling: boolean | undefined
function onTouchStart(event: TouchEvent) {
  touchY = event.touches[0]?.clientY ?? 0
  touchStart = { x: event.touches[0]?.clientX ?? 0, y: touchY }
  scrolling = undefined
  userPointer(true)
}
function onTouchMove(event: TouchEvent) {
  if (event.touches.length !== 1) return
  const touch = event.touches[0]!
  const dx = Math.abs(touch.clientX - touchStart.x)
  const dy = Math.abs(touch.clientY - touchStart.y)
  if (scrolling === undefined && Math.hypot(dx, dy) > 10) scrolling = dx < dy * 1.2
  const nextY = touch.clientY
  if (scrolling && nextY !== touchY) userScrollIntent(nextY > touchY ? 'up' : 'down')
  touchY = nextY
}
function onWheel(event: WheelEvent) {
  if (event.deltaY) userScrollIntent(event.deltaY < 0 ? 'up' : 'down')
}

const viewportEl = useTemplateRef<HTMLElement>('viewport')
defineExpose({ element: viewportEl })

watch(() => props.preserveScrollOnPrepend, setPreserveScrollOnPrepend, { immediate: true })

// Keys typed into a field inside the timeline edit text; they don't scroll it.
function onKeyDown(event: KeyboardEvent) {
  if (!SCROLL_KEYS.has(event.key) || isEditable(event.target)) return
  const upward =
    ['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)
  userScrollIntent(upward ? 'up' : 'down')
}

let resizeObserver: ResizeObserver | null = null
let resizeFrame = 0

onMounted(() => {
  const viewport = viewportEl.value
  setViewportElement(viewport)
  if (!viewport || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => {
    window.cancelAnimationFrame(resizeFrame)
    resizeFrame = window.requestAnimationFrame(handleResize)
  })
  resizeObserver.observe(viewport)
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(resizeFrame)
  resizeObserver?.disconnect()
  resizeObserver = null
  setViewportElement(null)
})
</script>

<template>
  <div
    ref="viewport"
    data-slot="message-scroller-viewport"
    :data-scrollable="scrollableAttr"
    :data-autoscrolling="autoscrolling ? '' : undefined"
    @scroll="syncAfterScroll()"
    @pointerdown.passive="onPointerDown"
    @touchstart.passive="onTouchStart"
    @wheel.passive="onWheel"
    @touchmove.passive="onTouchMove"
    @keydown="onKeyDown"
  >
    <slot />
  </div>
</template>
