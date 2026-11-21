<script setup vapor lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../utils/cn'
import { tabStops } from '../../../utils/focus-dom'
import { panelEvent, type PanelEvent } from '../../../composables/shared/useFloatingPanel'
import { dialogKey } from './context'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  class?: HTMLAttributes['class']
  overlayClass?: HTMLAttributes['class']
}>()
const emit = defineEmits<{
  openAutoFocus: [event: PanelEvent]
  closeAutoFocus: [event: PanelEvent]
}>()
const dialog = inject(dialogKey)!
const panel = ref<HTMLElement | null>(null)
const dismiss = () => {
  dialog.open.value = false
}
useFocusBoundary(panel, dialog.open, { modal: true, escape: dismiss })

watch(
  panel,
  async (element, _, cleanup) => {
    if (!element) return
    const opener = document.activeElement
    let active = true
    cleanup(() => {
      active = false
      void nextTick(() => {
        const event = panelEvent(element)
        emit('closeAutoFocus', event)
        if (
          !event.defaultPrevented &&
          opener instanceof HTMLElement &&
          opener.isConnected &&
          document.activeElement === document.body
        )
          opener.focus({ preventScroll: true })
      })
    })
    await nextTick()
    if (!active) return
    const event = panelEvent(element)
    emit('openAutoFocus', event)
    if (!event.defaultPrevented) (tabStops(element)[0] ?? element).focus({ preventScroll: true })
  },
  { flush: 'post' },
)
</script>

<template>
  <Teleport to="body">
    <template v-if="dialog.open.value">
      <div
        data-slot="dialog-overlay"
        aria-hidden="true"
        :class="cn('fixed inset-0 z-[70] bg-[rgb(5_5_10_/_65%)]', props.overlayClass)"
        @click.self="dismiss"
      />
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="dialog.titleId"
        tabindex="-1"
        data-slot="dialog-content"
        data-state="open"
        v-bind="$attrs"
        :class="
          cn(
            'fixed inset-0 z-[70] m-auto h-fit w-[min(calc(460px_*_var(--interface-scale,1)),_calc(100vw_-_24px))] max-h-[calc(100dvh_-_48px)] overflow-auto rounded-lg bg-background p-0 text-foreground shadow-popover outline-none',
            props.class,
          )
        "
      >
        <slot />
      </div>
    </template>
  </Teleport>
</template>
