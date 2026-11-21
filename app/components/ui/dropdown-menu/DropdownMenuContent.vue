<script setup vapor lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../utils/cn'
import {
  useFloatingPanel,
  type PanelAlign,
  type PanelEvents,
  type PanelSide,
} from '../../../composables/shared/useFloatingPanel'
import { nextOption } from '../../../utils/option-navigation'
import { dropdownMenuContentClass } from '.'
import { menuItemSelector, menuItems, menuKey } from './context'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  class?: HTMLAttributes['class']
  side?: PanelSide
  align?: PanelAlign
  sideOffset?: number
  collisionPadding?: number
}>()
const emit = defineEmits<PanelEvents>()
const root = inject(menuKey)!
const { panel, style } = useFloatingPanel(root, props, emit, (node) => {
  if (!root.focusOnOpen.value) return
  const items = menuItems(node)
  const first = items.find((item) => item.getAttribute('aria-disabled') !== 'true')
  ;(root.edge.value === 'last' ? items.at(-1) : (first ?? items[0] ?? node))?.focus({
    preventScroll: true,
  })
})
let query = ''
let typedAt = 0
function navigate(event: KeyboardEvent) {
  if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
  const node = event.currentTarget as HTMLElement
  const items = menuItems(node)
  const at = items.indexOf(event.target as HTMLButtonElement)
  if (event.key === 'ArrowLeft' && root.parent) {
    event.preventDefault()
    root.open.value = false
    return
  }
  if (event.key === 'Tab') {
    root.closeAll()
    return
  }
  const next = nextOption(
    event.key,
    items.map((_, i) => i),
    at,
  )
  if (next !== undefined) {
    event.preventDefault()
    items[next]?.focus()
  } else if (event.key.length === 1 && event.key !== ' ') {
    const now = performance.now()
    query = (now - typedAt < 550 ? query : '') + event.key.toLowerCase()
    typedAt = now
    const ordered = [...items.slice(at + 1), ...items.slice(0, at + 1)]
    ordered
      .find((item) =>
        (item.getAttribute('aria-label') ?? item.textContent ?? '')
          .trim()
          .toLowerCase()
          .startsWith(query),
      )
      ?.focus()
  }
}
function hover(event: PointerEvent) {
  if (event.pointerType === 'touch' || !(event.target instanceof Element)) return
  const item = event.target.closest<HTMLButtonElement>(menuItemSelector)
  if (!item || item.closest('[role="menu"]') !== panel.value) return
  if (!item.hasAttribute('aria-haspopup')) root.submenu.value = ''
  if (panel.value?.contains(document.activeElement) && item !== document.activeElement)
    item.focus({ preventScroll: true })
}
</script>
<template>
  <Teleport to="body">
    <div
      v-if="root.open.value"
      :id="root.id"
      ref="panel"
      role="menu"
      tabindex="-1"
      data-slot="dropdown-menu-content"
      data-state="open"
      v-bind="$attrs"
      :style="style"
      :class="cn('fixed', dropdownMenuContentClass, props.class)"
      @keydown="navigate"
      @pointermove="hover"
    >
      <slot />
    </div>
  </Teleport>
</template>
