<script setup vapor lang="ts">
import { cn } from '../../../utils/cn'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()

function navigate(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented)
    return
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const list = event.currentTarget as HTMLElement
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('button[role="tab"]:enabled')]
  const at = tabs.indexOf(event.target as HTMLButtonElement)
  if (at < 0) return
  event.preventDefault()
  const rtl = getComputedStyle(list).direction === 'rtl'
  const step = event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 1
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (at + step + tabs.length) % tabs.length
  tabs[next]?.focus()
  if (next !== at) tabs[next]?.click()
}
</script>

<template>
  <div
    role="tablist"
    data-slot="tabs-list"
    :class="cn('flex items-center', props.class)"
    @keydown="navigate"
  >
    <slot />
  </div>
</template>
