<script setup vapor lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../utils/cn'
import { dropdownMenuItemVariants, type DropdownMenuItemVariants } from '.'
import { menuKey } from './context'
const props = withDefaults(
  defineProps<{
    disabled?: boolean
    checked?: boolean | null
    variant?: DropdownMenuItemVariants['variant']
    class?: HTMLAttributes['class']
  }>(),
  { checked: null },
)
const emit = defineEmits<{ select: [event: Event] }>()
const root = inject(menuKey)!
const focus = ref(false)
const hover = ref(false)
const attrs = useAttrs()
function select() {
  if (props.disabled || attrs['aria-disabled'] === true || attrs['aria-disabled'] === 'true') return
  const event = new Event('select', { cancelable: true })
  emit('select', event)
  if (!event.defaultPrevented) root.closeAll()
}
</script>
<template>
  <button
    type="button"
    :role="checked === null ? 'menuitem' : 'menuitemcheckbox'"
    :aria-checked="checked ?? undefined"
    tabindex="-1"
    :disabled="disabled"
    data-slot="dropdown-menu-item"
    :data-disabled="disabled ? '' : undefined"
    :data-highlighted="focus || hover ? '' : undefined"
    :class="cn(dropdownMenuItemVariants({ variant }), props.class)"
    @focus="focus = true"
    @blur="focus = false"
    @pointerenter="hover = true"
    @pointerleave="hover = false"
    @click="select"
  >
    <slot />
  </button>
</template>
