<script setup vapor lang="ts">
import { cn } from '../../utils/cn'
import { settingsPagesKey } from '../../composables/settings/useSettingsPages'
import type { NavTone } from '../../../shared/settings-index'
/**
 * One section in a SettingsLayout list. The active one is marked as the current page. A `danger`
 * item (Log out) sits apart at the end of the list. On phones, choosing a section opens it.
 * The icon sits on a small tile in the section's `tone`.
 */
/** `detail` is the section's current value, shown before the chevron on phones. */
const props = defineProps<{
  icon?: string
  tone?: NavTone
  active?: boolean
  danger?: boolean
  detail?: string
}>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const pages = inject(settingsPagesKey, undefined)
/**
 * One listener: the section changes, then the page, so history records a single step. With two
 * listeners the browser runs pending updates between them and Back lands on a half-way page.
 */
function choose(event: MouseEvent) {
  emit('click', event)
  if (!props.danger) pages?.show()
}
// The scheme's palette hues, which every theme derives as readable code colours.
const toneColors: Record<NavTone, string> = {
  red: 'var(--code-deletion)',
  orange: 'var(--code-number)',
  yellow: 'var(--code-type)',
  green: 'var(--code-string)',
  cyan: 'var(--code-property)',
  blue: 'var(--code-function)',
  purple: 'var(--code-keyword)',
  pink: 'var(--code-meta)',
}
const tile = computed(() => {
  const color = props.tone && !props.danger ? toneColors[props.tone] : undefined
  return color ? { color, background: `color-mix(in srgb, ${color} 16%, transparent)` } : undefined
})
const el = ref<HTMLButtonElement | null>(null)
// Keep the chosen section in view when the list scrolls.
watch(
  () => props.active,
  (active) =>
    active && nextTick(() => el.value?.scrollIntoView({ block: 'nearest', inline: 'nearest' })),
  { immediate: true },
)
</script>
<template>
  <button
    ref="el"
    type="button"
    :class="
      cn(
        'flex min-h-[34px] items-center gap-2.5 rounded-sm px-2 py-1 text-left text-[length:var(--ui-text)] text-muted-foreground hover:bg-accent hover:text-foreground max-[700px]:min-h-12 max-[700px]:shrink-0 max-[700px]:gap-3 max-[700px]:rounded-md max-[700px]:px-2.5 max-[700px]:text-[15px] max-[700px]:text-foreground [@media(pointer:coarse)]:min-h-[44px]',
        active && 'active bg-selection text-foreground',
        // On phones the list is a menu of pages; no section is shown as current there.
        active && 'max-[700px]:bg-transparent max-[700px]:hover:bg-accent',
        danger &&
          'settings-logout mt-auto text-destructive hover:bg-destructive hover:text-rail focus-visible:bg-destructive focus-visible:text-rail max-[700px]:mt-3 max-[700px]:text-destructive',
      )
    "
    :aria-current="active ? 'page' : undefined"
    @click="choose"
  >
    <span
      v-if="icon"
      class="nav-icon grid size-6.5 shrink-0 place-items-center rounded-md max-[700px]:size-8 max-[700px]:rounded-lg"
      :class="{ 'bg-current/12': danger || !tile }"
      :style="tile"
      ><AppIcon
        :name="icon"
        :size="16"
    /></span>
    <slot /><span
      v-if="detail && pages"
      class="ml-auto hidden min-w-0 max-w-[50%] truncate text-[13px] text-muted-foreground max-[700px]:block"
      >{{ detail }}</span
    ><AppIcon
      v-if="!danger && pages"
      name="right"
      :size="16"
      class="hidden shrink-0 text-faint max-[700px]:block"
      :class="{ 'ml-auto': !detail }"
    />
  </button>
</template>
