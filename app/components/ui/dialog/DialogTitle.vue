<script setup vapor lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../utils/cn'
import { dialogKey } from './context'
const props = withDefaults(
  defineProps<{ as?: 'h2' | 'h3' | 'h4'; class?: HTMLAttributes['class'] }>(),
  { as: 'h2' },
)
const dialog = inject(dialogKey)!
</script>
<template>
  <component
    :is="as"
    :id="dialog.titleId"
    data-slot="dialog-title"
    :class="cn(props.class)"
    ><slot
  /></component>
</template>
