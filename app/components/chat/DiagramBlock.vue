<script setup vapor lang="ts">
/**
 * A `mermaid` fence drawn as a diagram, in the code block's frame: the label, a toggle to the
 * source and a copy button that always copies the source. The source shows until the diagram is
 * drawn, and stays as an ordinary code block with a note when it cannot be drawn.
 */
const props = defineProps<{ code: string; lang: string }>()
const chat = useChatStore()
const appearance = useAppearanceStore()
const { t } = useI18n()
const $t = t

const frame = useTemplateRef<HTMLElement>('frame')
/**
 * The scrolling list the block sits in (the timeline). Measured against the window, a block
 * clipped by that list would only count once visible, and the margin below would do nothing.
 */
const scroller = computed(() => {
  for (let element = frame.value?.parentElement; element; element = element.parentElement)
    if (
      /auto|scroll/.test(getComputedStyle(element).overflowY) &&
      element.scrollHeight > element.clientHeight
    )
      return element
  return null
})
/** Mermaid loads, and the diagram draws, only once the block comes near the viewport. */
const near = ref(false)
const { stop } = useIntersectionObserver(
  frame,
  ([entry]) => {
    if (!entry?.isIntersecting) return
    near.value = true
    stop()
  },
  { root: scroller, rootMargin: '400px 0px' },
)

const theme = computed((): DiagramTheme => {
  const tokens = appearance.tokens
  return {
    dark: appearance.mode === 'dark',
    background: tokens.rail,
    surface: tokens.raised,
    border: tokens.border,
    text: tokens.text,
    muted: tokens.muted,
    series: [tokens.accent, tokens.mint, tokens.yellow, tokens.danger],
  }
})

const picture = ref<DiagramPicture | null>(null)
const failed = ref(false)
const showSource = ref(false)
watch(
  () => [near.value, props.code, theme.value] as const,
  ([visible, code, colours], _, onCleanup) => {
    if (!visible) return
    let current = true
    onCleanup(() => (current = false))
    void renderDiagram(code, colours).then((value) => {
      if (!current) return
      picture.value = value
      failed.value = value === null
    })
  },
  { immediate: true },
)

/** The picture shown in the full-window view, or null while it is closed. */
const fullscreen = ref<DiagramPicture | null>(null)
/**
 * Opens the same picture full-window. It is asked for again because the cache may have dropped
 * (and revoked) it since the message drew it; a cached picture comes straight back.
 */
async function showFullscreen() {
  const value = await renderDiagram(props.code, theme.value)
  if (value) fullscreen.value = value
}

const copied = ref(false)
let reset: ReturnType<typeof setTimeout> | undefined
/** Copies the diagram's source exactly as sent. */
async function copy() {
  try {
    await usePlatform().copyText(props.code)
  } catch {
    chat.notify(t('workspaceUi.controls.copyFailed'))
    return
  }
  copied.value = true
  clearTimeout(reset)
  reset = setTimeout(() => (copied.value = false), 1500)
}
onBeforeUnmount(() => clearTimeout(reset))
</script>
<template>
  <div
    v-if="failed"
    ref="frame"
    class="diagram-failed block"
  >
    <CodeBlock
      :code="code"
      :lang="lang"
    />
    <span class="block -mt-0.5 mb-1 text-muted-foreground text-[0.85em]">{{
      $t('workspaceUi.controls.diagramFailed')
    }}</span>
  </div>
  <div
    v-else
    ref="frame"
    class="code-frame diagram-frame block [box-sizing:border-box] max-w-full my-1 mx-0 bg-rail border border-solid border-border rounded-[6px] overflow-hidden"
  >
    <div
      class="code-head flex items-center justify-between gap-2 min-h-6.5 pt-[3px] pr-1 pb-0 pl-2.5"
    >
      <span
        class="code-lang text-faint font-sans text-[11px] lowercase"
        aria-hidden="true"
        >{{ lang }}</span
      >
      <button
        v-if="picture"
        type="button"
        class="diagram-toggle ml-auto px-1.5 h-6 border border-solid border-transparent rounded-[5px] [background:none] text-muted-foreground font-sans text-[11px] cursor-pointer"
        :aria-pressed="showSource"
        @click.stop="showSource = !showSource"
      >
        {{
          showSource
            ? $t('workspaceUi.controls.showDiagram')
            : $t('workspaceUi.controls.showSource')
        }}
      </button>
      <button
        v-if="picture"
        type="button"
        class="diagram-toggle px-1.5 h-6 border border-solid border-transparent rounded-[5px] [background:none] text-muted-foreground font-sans text-[11px] cursor-pointer"
        aria-haspopup="dialog"
        @click.stop="showFullscreen"
      >
        {{ $t('workspaceUi.controls.showFullscreen') }}
      </button>
      <button
        type="button"
        class="code-copy grid [place-items:center] w-6 h-6 p-0 border border-solid border-transparent rounded-[5px] [background:none] text-muted-foreground cursor-pointer [opacity:0] [transition:opacity_0.12s_ease]"
        :class="[{ 'is-copied': copied }, picture ? '' : 'ml-auto']"
        :aria-label="
          copied ? $t('workspaceUi.controls.copied') : $t('workspaceUi.controls.copyDiagram')
        "
        :title="copied ? $t('workspaceUi.controls.copied') : $t('workspaceUi.controls.copyDiagram')"
        @click.stop="copy"
      >
        <AppIcon
          :name="copied ? 'check' : 'copy'"
          :size="14"
        />
      </button>
    </div>
    <div
      v-if="picture && !showSource"
      class="diagram-view block max-h-[24rem] pt-0.5 pr-2.5 pb-2 pl-2.5 overflow-auto overscroll-contain"
      tabindex="0"
      role="group"
      :aria-label="$t('workspaceUi.controls.diagram', { language: lang })"
    >
      <img
        class="diagram-picture block max-w-full h-auto"
        :src="picture.url"
        :width="picture.width"
        :height="picture.height"
        :alt="$t('workspaceUi.controls.diagramPicture')"
        draggable="false"
      />
    </div>
    <pre
      v-else
      class="code-block block [box-sizing:border-box] max-w-full max-h-[24rem] m-0 pt-0.5 pr-2.5 pb-2 pl-2.5 overflow-auto overscroll-contain font-code text-[0.88em] leading-[1.45] whitespace-pre [overflow-wrap:normal] [tab-size:4]"
      tabindex="0"
      role="group"
      :aria-label="$t('workspaceUi.controls.languageCode', { language: lang })"
    ><code>{{ code }}</code></pre>
    <span
      class="sr-only"
      aria-live="polite"
      >{{ copied ? $t('workspaceUi.controls.diagramCopied') : '' }}</span
    >
    <DiagramViewer
      v-if="fullscreen"
      :picture="fullscreen"
      :lang="lang"
      @close="fullscreen = null"
    />
  </div>
</template>
