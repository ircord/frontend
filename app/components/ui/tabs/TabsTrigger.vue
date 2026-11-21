<script setup vapor lang="ts">
import { cn } from '../../../utils/cn'
import type { HTMLAttributes } from 'vue'
import type { TabsTriggerVariants } from '.'
import { tabsTriggerVariants } from '.'
import { tabsKey, tabId } from './context'

const props = defineProps<{
  value: string
  disabled?: boolean
  class?: HTMLAttributes['class']
  variant?: TabsTriggerVariants['variant']
}>()

const tabs = inject(tabsKey)!
const active = computed(() => tabs.selected.value === props.value)
function select() {
  if (!props.disabled) tabs.selected.value = props.value
}
</script>

<template>
  <button
    :id="tabId(tabs.id, 'tab', value)"
    type="button"
    role="tab"
    :aria-controls="tabId(tabs.id, 'panel', value)"
    :aria-selected="active"
    :tabindex="active ? 0 : -1"
    :disabled="disabled"
    :data-state="active ? 'active' : 'inactive'"
    data-slot="tabs-trigger"
    :class="cn(tabsTriggerVariants({ variant }), props.class)"
    @click="select"
  >
    <slot />
  </button>
</template>
