<script setup vapor lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../utils/cn'
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
<template>
  <div
    role="separator"
    data-slot="dropdown-menu-separator"
    :class="cn('my-1 h-px bg-border', props.class)"
  />
</template>
