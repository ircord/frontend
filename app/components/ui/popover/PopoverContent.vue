<script setup vapor lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../utils/cn'
import {
  popoverKey,
  useFloatingPanel,
  type PanelAlign,
  type PanelEvents,
  type PanelSide,
} from '../../../composables/shared/useFloatingPanel'
import { popoverContentClass } from '.'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  class?: HTMLAttributes['class']
  side?: PanelSide
  align?: PanelAlign
  sideOffset?: number
  collisionPadding?: number
}>()
const emit = defineEmits<PanelEvents>()
const root = inject(popoverKey)!
const { panel, style } = useFloatingPanel(root, props, emit)
</script>
<template>
  <Teleport to="body">
    <div
      v-if="root.open.value"
      :id="root.id"
      ref="panel"
      role="dialog"
      tabindex="-1"
      data-slot="popover-content"
      data-state="open"
      v-bind="$attrs"
      :class="cn('fixed', popoverContentClass, props.class)"
      :style="style"
    >
      <slot />
    </div>
  </Teleport>
</template>
