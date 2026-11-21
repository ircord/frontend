<script setup vapor lang="ts">
import { cn } from '../../../utils/cn'
import type { HTMLAttributes } from 'vue'

const props = defineProps<{ disabled?: boolean; class?: HTMLAttributes['class'] }>()
const checked = defineModel<boolean | 'indeterminate'>({ default: false })
const state = computed(() =>
  typeof checked.value === 'string' ? checked.value : checked.value ? 'checked' : 'unchecked',
)
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="state === 'indeterminate' ? 'mixed' : checked === true"
    data-slot="checkbox"
    :data-state="state"
    :data-disabled="disabled ? '' : undefined"
    :disabled="disabled"
    :class="
      cn(
        'grid size-4 shrink-0 place-items-center rounded-[4px] border border-solid border-control bg-field text-primary-foreground transition-[background,border-color] duration-[120ms] data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-45',
        props.class,
      )
    "
    @keydown.enter.prevent
    @click="checked = checked !== true"
  >
    <span
      v-if="checked"
      class="grid place-items-center"
      aria-hidden="true"
    >
      <AppIcon
        name="check"
        :size="12"
      />
    </span>
  </button>
</template>
