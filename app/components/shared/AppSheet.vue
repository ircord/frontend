<!-- Not Vapor: Reka's dialog parts merge props into VNode slots. -->
<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'

/**
 * A sheet from the bottom of a phone screen, for menus. Drag it down, tap outside, press Escape or
 * Back to close it: it slides away, then emits `close`. `back` shows a back arrow before the title
 * (a second page inside the sheet). Rows are SheetItems, grouped into cards.
 */
const props = defineProps<{
  title: string
  /** Keeps the title for assistive technology only. */
  hideTitle?: boolean
  description?: string
  /** The back arrow's label; without it there is no back arrow. */
  back?: string
}>()
const emit = defineEmits<{ close: []; back: [] }>()

// Back closes the sheet, like a dialog.
const unregister = useDialogStack().register(() => emit('close'))
onBeforeUnmount(unregister)

const content = ref<{ $el: HTMLElement } | null>(null)
const sheet = computed(() => content.value?.$el ?? null)
const scroller = ref<HTMLElement | null>(null)
const leaving = ref(false)
/** Slides the sheet away, then asks to be closed. */
function dismiss() {
  if (leaving.value) return
  leaving.value = true
  if (sheet.value) sheet.value.style.transform = ''
  const reduced = document.documentElement.dataset.motion === 'reduced'
  setTimeout(() => emit('close'), reduced ? 0 : 180)
}
function openChange(open: boolean) {
  if (!open) dismiss()
}
function focusSheet(event: Event) {
  event.preventDefault()
  sheet.value?.focus({ preventScroll: true })
}
defineExpose({ scrollToTop: () => scroller.value?.scrollTo({ top: 0 }) })

// Dragging down from the top of the list moves the sheet; far enough or fast enough closes it.
let drag: { y: number; x: number; time: number; moved: number; active: boolean } | null = null
function touchStart(event: TouchEvent) {
  const touch = event.touches[0]
  if (!touch || event.touches.length > 1 || leaving.value) return
  drag = { y: touch.clientY, x: touch.clientX, time: Date.now(), moved: 0, active: false }
}
function touchMove(event: TouchEvent) {
  const touch = event.touches[0]
  if (!drag || !touch || !sheet.value) return
  const dy = touch.clientY - drag.y
  if (!drag.active) {
    const atTop = (scroller.value?.scrollTop ?? 0) <= 0
    if (dy < 8 || !atTop || Math.abs(touch.clientX - drag.x) > dy) {
      if (Math.abs(dy) > 8 || Math.abs(touch.clientX - drag.x) > 8) drag = null
      return
    }
    drag.active = true
    drag.y = touch.clientY
    drag.time = Date.now()
    sheet.value.style.transition = 'none'
  }
  event.preventDefault()
  drag.moved = Math.max(0, touch.clientY - drag.y)
  sheet.value.style.transform = `translateY(${drag.moved}px)`
}
function touchEnd() {
  const d = drag
  drag = null
  if (!d?.active || !sheet.value) return
  sheet.value.style.transition = ''
  const fast = d.moved / Math.max(1, Date.now() - d.time) > 0.5
  if (fast || d.moved > sheet.value.offsetHeight / 4) dismiss()
  else sheet.value.style.transform = ''
}
useEventListener(sheet, 'touchstart', touchStart, { passive: true })
useEventListener(sheet, 'touchmove', touchMove, { passive: false })
useEventListener(sheet, 'touchend', touchEnd, { passive: true })
useEventListener(sheet, 'touchcancel', touchEnd, { passive: true })
</script>
<template>
  <DialogRoot
    :open="true"
    @update:open="openChange"
  >
    <DialogPortal>
      <DialogOverlay
        class="menu-sheet-overlay fixed inset-0 z-[70] bg-[rgb(5_5_10_/_55%)]"
        :data-leaving="leaving || undefined"
      />
      <DialogContent
        ref="content"
        class="menu-sheet fixed inset-x-0 bottom-0 z-[70] flex max-h-[85dvh] flex-col rounded-t-2xl bg-popover text-popover-foreground shadow-[0_-8px_32px_rgb(0_0_0_/_35%),inset_0_1px_0_color-mix(in_srgb,var(--text)_6%,transparent)] outline-none"
        :data-leaving="leaving || undefined"
        @open-auto-focus="focusSheet"
        @close-auto-focus.prevent
        @contextmenu.prevent.stop
      >
        <span
          class="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-foreground/25"
          aria-hidden="true"
        />
        <header class="flex min-h-11 shrink-0 items-center gap-2.5 px-4 pb-2">
          <button
            v-if="back"
            type="button"
            class="-ml-2 -mr-1.5 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-foreground/8"
            :aria-label="back"
            @click="emit('back')"
          >
            <AppIcon
              name="back"
              :size="20"
            />
          </button>
          <slot name="leading" />
          <div class="min-w-0 flex-1">
            <DialogTitle
              class="truncate text-[length:calc(16px_*_var(--interface-scale,1))] font-[650]"
              :class="{ 'sr-only': props.hideTitle }"
              >{{ title }}</DialogTitle
            >
            <DialogDescription
              v-if="description"
              class="truncate text-[length:var(--ui-small)] text-muted-foreground"
              >{{ description }}</DialogDescription
            >
          </div>
        </header>
        <!-- Cards keep their full height; a menu taller than the sheet scrolls. -->
        <div
          ref="scroller"
          class="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-[calc(12px_+_env(safe-area-inset-bottom))] [&>*]:shrink-0 [&>.sheet-card]:overflow-hidden [&>.sheet-card]:rounded-xl [&>.sheet-card]:bg-foreground/5"
        >
          <slot />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
<style>
.menu-sheet {
  animation: menu-sheet-up 0.22s cubic-bezier(0.2, 0.8, 0.3, 1);
  transition: transform 0.18s ease-out;
}
.menu-sheet[data-leaving] {
  transform: translateY(100%) !important;
}
.menu-sheet-overlay {
  animation: menu-sheet-fade 0.2s ease-out;
  transition: opacity 0.18s ease-out;
}
.menu-sheet-overlay[data-leaving] {
  opacity: 0;
}
@keyframes menu-sheet-up {
  from {
    transform: translateY(100%);
  }
}
@keyframes menu-sheet-fade {
  from {
    opacity: 0;
  }
}
:root[data-motion='reduced'] :is(.menu-sheet, .menu-sheet-overlay) {
  animation: none;
  transition: none;
}
</style>
