<script setup vapor lang="ts">
import { menuKey, menuRoot } from './context'
const open = defineModel<boolean>('open', { default: false })
const root = menuRoot(open)
provide(menuKey, root)
watch(open, (value) => {
  if (!value) root.submenu.value = ''
})
</script>
<template><slot /></template>
