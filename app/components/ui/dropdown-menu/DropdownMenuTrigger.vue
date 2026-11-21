<script setup vapor lang="ts">
import { panelTrigger } from '../../../composables/shared/useFloatingPanel'
import { menuKey } from './context'
const root = inject(menuKey)!
</script>
<template>
  <slot
    :bind="panelTrigger(root, 'menu')"
    :set-trigger="root.setAnchor"
  />
</template>
