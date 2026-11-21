<script setup vapor lang="ts">
import { cn } from '../../../utils/cn'
import type { HTMLAttributes } from 'vue'
import { radioGroupKey, type RadioChoice, type RadioValue } from './context'

const props = defineProps<{ disabled?: boolean; name?: string; class?: HTMLAttributes['class'] }>()
const value = defineModel<RadioValue>()
const choices = shallowReactive(new Set<RadioChoice>())
const tabStop = computed(() => {
  const enabled = [...choices].filter((choice) => !choice.disabled.value)
  return enabled.find((choice) => choice.checked.value) ?? enabled[0]
})
provide(radioGroupKey, {
  value,
  disabled: () => !!props.disabled,
  tabStop,
  register(choice) {
    choices.add(choice)
    return () => choices.delete(choice)
  },
  select(next) {
    if (!props.disabled && next !== value.value) value.value = next
  },
})

function navigate(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented)
    return
  const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key)) return
  const root = event.currentTarget as HTMLElement
  const radios = [
    ...root.querySelectorAll<HTMLButtonElement>('button[role="radio"]:enabled'),
  ].filter((button) => button.closest('[role="radiogroup"]') === root)
  const index = radios.indexOf(event.target as HTMLButtonElement)
  if (index < 0) return
  event.preventDefault()
  const rtl = getComputedStyle(root).direction === 'rtl'
  const backwards = event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? radios.length - 1
        : (index + (backwards ? -1 : 1) + radios.length) % radios.length
  radios[next]?.focus()
  if (next !== index && radios[next]?.getAttribute('aria-checked') !== 'true') radios[next]?.click()
}
</script>

<template>
  <div
    role="radiogroup"
    :aria-disabled="disabled || undefined"
    data-slot="radio-group"
    :class="cn('grid gap-3', props.class)"
    @keydown="navigate"
  >
    <slot />
    <input
      v-if="name && value !== undefined && !disabled"
      type="hidden"
      :name="name"
      :value="value"
    />
  </div>
</template>
