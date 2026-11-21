<script setup vapor lang="ts">
import { cn } from '../../../utils/cn'
import type { HTMLAttributes } from 'vue'
import { tabsKey } from './context'

const props = defineProps<{ defaultValue?: string; class?: HTMLAttributes['class'] }>()
const model = defineModel<string>()
const selected = computed({
  get: () => model.value ?? props.defaultValue,
  set: (value) => (model.value = value),
})
provide(tabsKey, { id: useId(), selected })
</script>

<template>
  <div
    data-slot="tabs"
    :class="cn(props.class)"
  >
    <slot />
  </div>
</template>
