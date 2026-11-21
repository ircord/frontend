<script setup lang="ts">
import type { MenuItem, QuickAction } from '../../composables/shared/useContextMenu'

/**
 * The shared menu on phones (AppSheet): the same items, grouped into cards at the separators.
 * A submenu opens as a second page.
 */
const { t } = useI18n()
const { state, close } = useContextMenu()
const sub = ref<MenuItem | null>(null)
const sheet = ref<{ scrollToTop: () => void } | null>(null)
watch(
  () => state.items,
  () => (sub.value = null),
)
const groups = computed(() => {
  const out: MenuItem[][] = [[]]
  for (const entry of sub.value?.children ?? state.items) {
    if (entry !== '-') out.at(-1)!.push(entry)
    else if (out.at(-1)!.length) out.push([])
  }
  return out.filter((group) => group.length)
})
const title = computed(() => sub.value?.label ?? state.title)
function choose(item: MenuItem | QuickAction) {
  if ('children' in item && item.children) {
    sub.value = item
    sheet.value?.scrollToTop()
    return
  }
  if ('disabled' in item && item.disabled) return
  close()
  item.action?.()
}
</script>
<template>
  <AppSheet
    ref="sheet"
    :title="title || t('workspaceUi.shell.actions')"
    :hide-title="!title"
    :description="sub ? undefined : state.detail || undefined"
    :back="
      sub
        ? t('settings.backTo', { name: state.title || t('workspaceUi.shell.actions') })
        : undefined
    "
    @back="sub = null"
    @close="close(false)"
  >
    <div
      v-if="state.quick.length && !sub"
      class="flex gap-2"
    >
      <button
        v-for="quick in state.quick"
        :key="quick.emoji"
        type="button"
        class="grid h-12 min-w-0 flex-1 place-items-center rounded-full bg-foreground/6 text-[24px] transition-transform active:scale-110 active:bg-primary/20 [&_img]:size-7"
        :aria-label="quick.label"
        @click="choose(quick)"
      >
        <CustomEmoji
          v-if="quick.item?.url"
          :item="quick.item"
          icon
        /><template v-else>{{ quick.emoji }}</template>
      </button>
    </div>
    <div
      v-for="(group, groupIndex) in groups"
      :key="`${sub?.label ?? ''}-${groupIndex}`"
      class="sheet-card"
    >
      <SheetItem
        v-for="(item, index) in group"
        :key="index"
        :label="item.label"
        :icon="item.icon"
        :danger="item.danger"
        :disabled="item.disabled"
        :reason="item.title"
        :hint="item.hint"
        :more="!!item.children"
        :checked="item.checked"
        @click="choose(item)"
      />
    </div>
  </AppSheet>
</template>
