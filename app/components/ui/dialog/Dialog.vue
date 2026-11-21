<script setup vapor lang="ts">
import { dialogKey } from './context'
const open = defineModel<boolean>('open', { default: false })
provide(dialogKey, { open, titleId: useId() })
</script>
<template><slot /></template>
