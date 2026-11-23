<script setup vapor lang="ts">
/**
 * A diagram on its own, filling the window at its natural size and scrolling both ways when it is
 * larger. It shows the same picture the message already drew (a blob: URL), so opening it loads
 * nothing. Escape, the close button and a click outside the picture close it.
 */
const props = defineProps<{ picture: DiagramPicture; lang: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const open = ref(true)
watch(open, (value) => value || emit('close'))
</script>
<template>
  <UiDialog v-model:open="open">
    <UiDialogContent
      class="diagram-viewer w-[100vw] max-w-[none] h-[100dvh] max-h-[none] m-0 rounded-none shadow-none grid [grid-template-rows:auto_minmax(0,_1fr)] bg-rail overflow-hidden"
      :aria-describedby="undefined"
    >
      <header
        class="flex items-center gap-2 min-w-0 pt-[max(8px,_env(safe-area-inset-top))] pr-2 pb-2 pl-4 border-b border-solid border-border"
      >
        <UiDialogTitle
          as="h2"
          class="flex-1 min-w-0 text-[14px] font-[600] truncate"
          >{{ t('workspaceUi.controls.diagram', { language: lang }) }}</UiDialogTitle
        >
        <button
          type="button"
          class="diagram-toggle grid [place-items:center] w-9 h-9 p-0 border border-solid border-transparent rounded-[6px] [background:none] text-muted-foreground cursor-pointer"
          :aria-label="t('workspaceUi.controls.closeFullscreen')"
          :title="t('workspaceUi.controls.closeFullscreen')"
          @click="open = false"
        >
          <AppIcon
            name="close"
            :size="20"
          />
        </button>
      </header>
      <div
        class="diagram-view flex min-h-0 overflow-auto overscroll-contain p-4"
        tabindex="0"
        role="group"
        :aria-label="t('workspaceUi.controls.diagram', { language: lang })"
        @click.self="open = false"
      >
        <img
          class="diagram-picture block m-auto max-w-none shrink-0"
          :src="props.picture.url"
          :width="props.picture.width"
          :height="props.picture.height"
          :alt="t('workspaceUi.controls.diagramPicture')"
          draggable="false"
        />
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
