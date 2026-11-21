<script setup vapor lang="ts">
import { cn } from '../../../utils/cn'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{ disabled?: boolean; class?: HTMLAttributes['class'] }>()
const checked = defineModel<boolean>({ default: false })
const state = computed(() => (checked.value ? 'checked' : 'unchecked'))
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="checked"
    data-slot="switch"
    :data-state="state"
    :data-disabled="disabled ? '' : undefined"
    :disabled="disabled"
    :class="
      cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-[10px] bg-border transition-[background] duration-150 data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-45',
        props.class,
      )
    "
    @click="checked = !checked"
  >
    <span
      data-slot="switch-thumb"
      :data-state="state"
      aria-hidden="true"
      class="pointer-events-none absolute top-0.5 left-0.5 block size-4 rounded-full bg-foreground transition-transform duration-150 data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-foreground"
    />
  </button>
</template>
