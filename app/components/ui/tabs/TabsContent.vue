<script setup vapor lang="ts">
import { cn } from '../../../utils/cn'
import type { HTMLAttributes } from 'vue'
import { tabsKey, tabId } from './context'

const props = defineProps<{ value: string; class?: HTMLAttributes['class'] }>()
const tabs = inject(tabsKey)!
const active = computed(() => tabs.selected.value === props.value)
</script>

<template>
  <div
    :id="tabId(tabs.id, 'panel', value)"
    role="tabpanel"
    tabindex="0"
    :aria-labelledby="tabId(tabs.id, 'tab', value)"
    :data-state="active ? 'active' : 'inactive'"
    :hidden="!active"
    data-slot="tabs-content"
    :class="cn(props.class)"
  >
    <slot v-if="active" />
  </div>
</template>
