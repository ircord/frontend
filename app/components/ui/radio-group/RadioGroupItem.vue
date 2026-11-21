<script setup vapor lang="ts">
import { cn } from '../../../utils/cn'
import type { HTMLAttributes } from 'vue'
import { CircleIcon } from '@lucide/vue'
import { radioGroupKey, type RadioValue } from './context'

const props = withDefaults(
  defineProps<{
    value: RadioValue
    disabled?: boolean
    class?: HTMLAttributes['class']
    variant?: 'default' | 'segment' | 'card' | 'swatch'
  }>(),
  { variant: 'default' },
)
const emit = defineEmits<{ select: [event: MouseEvent] }>()
const group = inject(radioGroupKey)!
const checked = computed(() => group.value.value === props.value)
const disabled = computed(() => !!props.disabled || group.disabled())
const choice = { checked, disabled }
onScopeDispose(group.register(choice))

function select(event: MouseEvent) {
  if (disabled.value) return
  emit('select', event)
  if (!event.defaultPrevented) group.select(props.value)
}
</script>

<template>
  <button
    type="button"
    role="radio"
    :aria-checked="checked"
    :disabled="disabled"
    :tabindex="group.tabStop.value === choice ? 0 : -1"
    data-slot="radio-group-item"
    :data-state="checked ? 'checked' : 'unchecked'"
    :data-disabled="disabled ? '' : undefined"
    :class="
      cn(
        'disabled:cursor-not-allowed disabled:opacity-45',
        variant === 'default' &&
          'relative aspect-square size-4 shrink-0 rounded-full border border-solid border-control bg-field text-primary aria-invalid:border-destructive',
        variant === 'segment' &&
          'inline-flex min-h-7 items-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-[11px] text-[length:var(--ui-caption)] whitespace-nowrap text-muted-foreground hover:text-foreground data-[state=checked]:bg-secondary data-[state=checked]:text-foreground data-[state=checked]:shadow-control',
        variant === 'card' &&
          'grid gap-1.5 content-start p-2 text-left text-[length:var(--ui-small)] bg-card rounded-md shadow-[inset_0_0_0_1px_var(--border)] transition-[box-shadow,transform] duration-[120ms] hover:shadow-[inset_0_0_0_1px_var(--faint)] data-[state=checked]:shadow-[inset_0_0_0_2px_var(--accent),0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)]',
        props.class,
      )
    "
    @keydown.enter.prevent
    @click.stop="select"
  >
    <span
      v-if="variant === 'default' && checked"
      data-slot="radio-group-indicator"
      class="relative flex items-center justify-center"
      aria-hidden="true"
    >
      <CircleIcon
        class="fill-primary absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2"
      />
    </span>
    <slot v-if="variant !== 'default'" />
  </button>
</template>
