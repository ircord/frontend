<script setup lang="ts">
const emit = defineEmits<{ join: [] }>()
const { t } = useI18n()
const actions = useWorkspaceActions()
const open = ref(false)
let hover = false
let timer: ReturnType<typeof setTimeout> | undefined
function enter(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  clearTimeout(timer)
  if (!open.value)
    timer = setTimeout(() => {
      hover = true
      open.value = true
    }, 250)
}
function leave(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  clearTimeout(timer)
  if (hover)
    timer = setTimeout(() => {
      open.value = false
      hover = false
    }, 350)
}
function change(value: boolean) {
  open.value = value
  if (!value) hover = false
}
/** Phones get the shared menu, which opens as a sheet from the bottom. */
const phone = useMediaQuery('(max-width: 700px)')
const contextMenu = useContextMenu()
function openSheet(event: MouseEvent) {
  contextMenu.open(
    event,
    [
      { label: t('channelCreate.joinExisting'), icon: 'hash', action: () => emit('join') },
      { label: t('channelCreate.title'), icon: 'plus', action: () => actions.createChannel() },
    ],
    t('channelCreate.menu'),
  )
}
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template>
  <UiButton
    v-if="phone"
    variant="ghost"
    size="icon-sm"
    class="size-[22px]"
    :aria-label="t('channelCreate.menu')"
    aria-haspopup="menu"
    @click="openSheet"
  >
    <AppIcon
      name="plus"
      :size="14"
    />
  </UiButton>
  <UiDropdownMenu
    v-else
    :open="open"
    @update:open="change"
  >
    <UiDropdownMenuTrigger v-slot="{ bind, setTrigger }">
      <UiButton
        :ref="setTrigger"
        v-bind="bind"
        variant="ghost"
        size="icon-sm"
        class="size-[22px]"
        :aria-label="t('channelCreate.menu')"
        @pointerenter="enter"
        @pointerleave="leave"
        @pointerdown.capture="hover && $event.preventDefault()"
      >
        <AppIcon
          name="plus"
          :size="14"
        />
      </UiButton>
    </UiDropdownMenuTrigger>
    <UiDropdownMenuContent
      align="end"
      @pointerenter="enter"
      @pointerleave="leave"
      @open-auto-focus="hover && $event.preventDefault()"
    >
      <UiDropdownMenuItem @select="emit('join')">{{
        t('channelCreate.joinExisting')
      }}</UiDropdownMenuItem>
      <UiDropdownMenuItem @select="actions.createChannel()">{{
        t('channelCreate.title')
      }}</UiDropdownMenuItem>
    </UiDropdownMenuContent>
  </UiDropdownMenu>
</template>
