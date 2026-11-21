<script setup vapor lang="ts">
import { panelTrigger, popoverKey } from '../../../composables/shared/useFloatingPanel'
const root = inject(popoverKey)!
</script>
<template>
  <slot
    :bind="panelTrigger(root, 'dialog')"
    :set-trigger="root.setAnchor"
  />
</template>
