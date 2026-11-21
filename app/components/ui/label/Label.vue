<script setup vapor lang="ts">
import { cn } from '../../../utils/cn'
import type { HTMLAttributes } from 'vue'
const props = defineProps<{ for?: string; class?: HTMLAttributes['class'] }>()

function preserveSingleClick(event: MouseEvent) {
  if (!event.defaultPrevented && event.detail > 1) event.preventDefault()
}
</script>

<template>
  <label
    data-slot="label"
    :for="props.for"
    :class="
      cn(
        'block text-[length:var(--ui-small)] font-[600] text-muted-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-55',
        props.class,
      )
    "
    @mousedown="preserveSingleClick"
  >
    <slot />
  </label>
</template>
