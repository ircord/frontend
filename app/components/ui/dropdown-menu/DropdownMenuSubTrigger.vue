<script setup vapor lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../utils/cn'
import { dropdownMenuItemVariants } from '.'
import { menuItems, menuKey } from './context'
const props = defineProps<{ disabled?: boolean; class?: HTMLAttributes['class'] }>()
const root = inject(menuKey)!
let timer: ReturnType<typeof setTimeout> | undefined
function show(keyboard: boolean) {
  clearTimeout(timer)
  if (props.disabled) return
  root.focusOnOpen.value = keyboard
  if (keyboard && root.open.value) {
    const panel = document.getElementById(root.id)
    if (panel) menuItems(panel)[0]?.focus()
  } else root.open.value = true
}
function hover(event: PointerEvent) {
  if (event.pointerType !== 'touch') timer = setTimeout(() => show(false), 120)
}
function leave() {
  clearTimeout(timer)
}
function keydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowRight') return
  event.preventDefault()
  show(true)
}
onBeforeUnmount(leave)
</script>
<template>
  <button
    :ref="root.setAnchor"
    type="button"
    role="menuitem"
    tabindex="-1"
    aria-haspopup="menu"
    :aria-expanded="root.open.value"
    :aria-controls="root.open.value ? root.id : undefined"
    :disabled="disabled"
    :data-disabled="disabled ? '' : undefined"
    :data-state="root.open.value ? 'open' : 'closed'"
    data-slot="dropdown-menu-sub-trigger"
    :class="
      cn(
        dropdownMenuItemVariants({ variant: 'default' }),
        'hover:bg-primary/16 focus:bg-primary/16',
        props.class,
      )
    "
    @pointerenter="hover"
    @pointerleave="leave"
    @keydown="keydown"
    @click="show(true)"
  >
    <slot />
  </button>
</template>
