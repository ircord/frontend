<script setup vapor lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../utils/cn'
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
<template>
  <div
    data-slot="dropdown-menu-label"
    :class="
      cn(
        'px-2.5 py-1.5 text-[length:var(--ui-caption)] font-semibold text-muted-foreground',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
