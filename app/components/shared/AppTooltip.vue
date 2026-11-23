<script lang="ts">
let lastDismissed = 0
let dismissCurrent: (() => void) | undefined
</script>

<script setup vapor lang="ts">
/**
 * A short label for an icon-only control (the slot), shown on hover and keyboard focus. Touch
 * screens don't show it, so the control still needs its own `aria-label`.
 */
const props = withDefaults(
  defineProps<{
    text: string
    side?: 'top' | 'right' | 'bottom' | 'left'
    /** Whether the label describes the control; off when the control's own name carries it. */
    describe?: boolean
  }>(),
  {
    side: 'bottom',
    describe: true,
  },
)

const id = useId()
const label = ref<HTMLElement | null>(null)
const open = ref(false)
const position = shallowRef<{ left: string; top: string }>()
let anchor: HTMLElement | undefined
let delay: ReturnType<typeof setTimeout> | undefined

function place() {
  if (!anchor?.isConnected || !label.value) return
  const rect = anchor.getBoundingClientRect()
  const { width, height } = label.value.getBoundingClientRect()
  const gap = 6
  const padding = 8
  const clamp = (value: number, max: number) => Math.max(padding, Math.min(value, max - padding))
  let left = rect.left + (rect.width - width) / 2
  let top = rect.top + (rect.height - height) / 2
  if (props.side === 'top' || props.side === 'bottom') {
    const above = rect.top - height - gap
    const below = rect.bottom + gap
    top =
      props.side === 'top'
        ? above >= padding
          ? above
          : below
        : below + height <= innerHeight - padding
          ? below
          : above
  } else {
    const before = rect.left - width - gap
    const after = rect.right + gap
    left =
      props.side === 'left'
        ? before >= padding
          ? before
          : after
        : after + width <= innerWidth - padding
          ? after
          : before
  }
  position.value = {
    left: `${clamp(left, innerWidth - width)}px`,
    top: `${clamp(top, innerHeight - height)}px`,
  }
}

function describedBy(element: HTMLElement) {
  return (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
}
function dismiss() {
  clearTimeout(delay)
  if (!anchor) return
  if (dismissCurrent === dismiss) dismissCurrent = undefined
  const description = describedBy(anchor)
  if (description.includes(id)) {
    const rest = description.filter((item) => item !== id)
    if (rest.length) anchor.setAttribute('aria-describedby', rest.join(' '))
    else anchor.removeAttribute('aria-describedby')
  }
  anchor = undefined
  if (open.value) lastDismissed = Date.now()
  open.value = false
  position.value = undefined
  window.removeEventListener('scroll', dismiss, true)
  window.removeEventListener('resize', dismiss)
  document.removeEventListener('keydown', escape, true)
}
function escape(event: KeyboardEvent) {
  if (event.key === 'Escape') dismiss()
}
function show(element: HTMLElement, immediate = false) {
  if (!props.text || anchor === element) return
  dismissCurrent?.()
  anchor = element
  dismissCurrent = dismiss
  window.addEventListener('scroll', dismiss, { capture: true, passive: true })
  window.addEventListener('resize', dismiss, { passive: true })
  document.addEventListener('keydown', escape, true)
  delay = setTimeout(
    async () => {
      if (anchor !== element) return
      open.value = true
      await nextTick()
      if (anchor !== element) return
      place()
      if (!props.describe) return
      element.setAttribute(
        'aria-describedby',
        [...new Set([...describedBy(element), id])].join(' '),
      )
    },
    immediate || Date.now() - lastDismissed < 300 ? 0 : 500,
  )
}

function inside(event: PointerEvent | FocusEvent) {
  return (
    event.relatedTarget instanceof Node &&
    (event.currentTarget as HTMLElement).contains(event.relatedTarget)
  )
}
function hover(event: PointerEvent) {
  if (event.pointerType === 'touch' || inside(event)) return
  const element = (event.currentTarget as HTMLElement).firstElementChild
  if (element instanceof HTMLElement) show(element)
}
function leave(event: PointerEvent | FocusEvent) {
  if (!inside(event)) dismiss()
}
function focus(event: FocusEvent) {
  if (event.target instanceof HTMLElement && event.target.matches(':focus-visible'))
    show(event.target, true)
}
watch(
  () => [props.text, props.side],
  () => {
    if (!props.text) dismiss()
    else if (open.value) place()
  },
  { flush: 'post' },
)
onBeforeUnmount(dismiss)
</script>
<template>
  <span
    class="contents"
    @pointerover="hover"
    @pointerout="leave"
    @pointerdown="dismiss"
    @focusin="focus"
    @focusout="leave"
  >
    <slot />
    <Teleport to="body">
      <span
        v-if="open"
        :id="id"
        ref="label"
        data-slot="tooltip-content"
        role="tooltip"
        class="pointer-events-none fixed z-[90] max-w-[min(17.5rem,calc(100vw_-_16px))] rounded-sm bg-foreground px-2 py-1 text-[length:var(--ui-caption)] leading-[1.4] text-background shadow-control [overflow-wrap:anywhere]"
        :style="position ?? { visibility: 'hidden' }"
        >{{ text }}</span
      >
    </Teleport>
  </span>
</template>
