<script setup vapor lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../utils/cn'

const props = withDefaults(
  defineProps<{
    min?: number
    max?: number
    step?: number
    label?: string
    disabled?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { min: 0, max: 100, step: 1 },
)
const model = defineModel<number[]>({ required: true })
const value = computed(() => model.value[0] ?? props.min)
const fill = computed(() => {
  const span = props.max - props.min
  return `${span > 0 ? Math.max(0, Math.min(100, (100 * (value.value - props.min)) / span)) : 0}%`
})
function update(event: Event) {
  const next = (event.currentTarget as HTMLInputElement).valueAsNumber
  if (Number.isFinite(next) && next !== value.value) model.value = [next]
}
</script>

<template>
  <input
    type="range"
    data-slot="slider"
    :class="
      cn(
        'ui-range h-4 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-45',
        props.class,
      )
    "
    :style="{ '--slider-fill': fill }"
    :aria-label="label"
    :min="min"
    :max="max"
    :step="step"
    :value="value"
    :disabled="disabled"
    @input="update"
  />
</template>

<style>
.ui-range {
  --slider-direction: to right;
  --slider-track: linear-gradient(
    var(--slider-direction),
    var(--primary) var(--slider-fill),
    var(--border) var(--slider-fill)
  );
}
.ui-range:dir(rtl) {
  --slider-direction: to left;
}
.ui-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: var(--slider-track);
}
.ui-range::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: var(--slider-track);
}
.ui-range::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border: 2px solid var(--primary);
  border-radius: 50%;
  background: var(--background);
}
.ui-range::-moz-range-thumb {
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  border: 2px solid var(--primary);
  border-radius: 50%;
  background: var(--background);
}
</style>
