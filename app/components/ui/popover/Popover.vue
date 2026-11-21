<script setup vapor lang="ts">
import { floatingRoot, popoverKey } from '../../../composables/shared/useFloatingPanel'
const props = defineProps<{ anchor?: HTMLElement | null }>()
const open = defineModel<boolean>('open', { default: false })
const root = floatingRoot(open)
provide(popoverKey, root)
watch(
  () => props.anchor,
  (value) => {
    if (value !== undefined) root.setAnchor(value)
  },
  { immediate: true },
)
</script>
<template><slot /></template>
