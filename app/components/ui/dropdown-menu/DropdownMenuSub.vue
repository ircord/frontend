<script setup vapor lang="ts">
import { menuKey, menuRoot } from './context'
const parent = inject(menuKey)!
const key = useId()
const open = computed({
  get: () => parent.open.value && parent.submenu.value === key,
  set: (value) => {
    if (value) parent.submenu.value = key
    else if (parent.submenu.value === key) parent.submenu.value = ''
  },
})
provide(menuKey, menuRoot(open, parent))
</script>
<template><slot /></template>
