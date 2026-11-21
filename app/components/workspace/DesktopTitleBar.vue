<script setup lang="ts" vapor>
import type { ResizeEdge } from '../../utils/platform'

const { titleBar, windowControls } = usePlatform()
const { t: $t } = useI18n()
const maximized = ref(false)
const fullscreen = ref(false)
const resizeEdges: ResizeEdge[] = [
  'North',
  'NorthEast',
  'East',
  'SouthEast',
  'South',
  'SouthWest',
  'West',
  'NorthWest',
]

async function refresh() {
  if (!windowControls) return
  const state = await Promise.all([
    windowControls.isMaximized(),
    windowControls.isFullscreen(),
  ]).catch(() => undefined)
  if (state) [maximized.value, fullscreen.value] = state
}

onMounted(refresh)
useEventListener(window, 'resize', refresh)

function toggleMaximize() {
  void windowControls
    ?.toggleMaximize()
    .then(refresh)
    .catch(() => {})
}

function resize(event: PointerEvent, edge: ResizeEdge) {
  if (event.button === 0) void windowControls?.startResizeDragging(edge).catch(() => {})
}

const maximizeLabel = computed(() =>
  $t(maximized.value ? 'workspaceUi.shell.restoreWindow' : 'workspaceUi.shell.maximizeWindow'),
)
</script>

<template>
  <div
    class="desktop-titlebar flex justify-end select-none"
    data-tauri-drag-region
  >
    <template v-if="titleBar !== 'macos' && windowControls">
      <button
        type="button"
        class="window-button"
        :aria-label="$t('workspaceUi.shell.minimizeWindow')"
        :title="$t('workspaceUi.shell.minimizeWindow')"
        @click="windowControls.minimize().catch(() => {})"
      >
        <AppIcon
          name="windowMinimize"
          :size="13"
        />
      </button>
      <button
        type="button"
        class="window-button"
        :aria-label="maximizeLabel"
        :title="maximizeLabel"
        @click="toggleMaximize"
      >
        <AppIcon
          :name="maximized ? 'copy' : 'windowMaximize'"
          :size="13"
        />
      </button>
      <button
        type="button"
        class="window-button window-close"
        :aria-label="$t('workspaceUi.shell.closeWindow')"
        :title="$t('workspaceUi.shell.closeWindow')"
        @click="windowControls.close().catch(() => {})"
      >
        <AppIcon
          name="close"
          :size="15"
        />
      </button>
    </template>
    <!-- Some Linux window managers leave resizing to the app for undecorated windows. -->
    <template v-if="titleBar === 'linux' && !maximized && !fullscreen">
      <div
        v-for="edge in resizeEdges"
        :key="edge"
        class="window-resize"
        :class="`window-resize-${edge}`"
        aria-hidden="true"
        @pointerdown.prevent="resize($event, edge)"
      />
    </template>
  </div>
</template>

<style scoped>
.window-button {
  display: grid;
  place-items: center;
  width: 44px;
  color: var(--muted-foreground);
}
.window-button:hover {
  background: var(--accent);
  color: var(--foreground);
}
.window-button:focus-visible {
  outline-offset: -2px;
}
.window-close:hover {
  background: var(--danger);
  color: var(--danger-foreground, white);
}
.window-resize {
  position: fixed;
  z-index: 100;
  --resize-width: 4px;
  --resize-corner: 9px;
}
.window-resize-North {
  inset: 0 var(--resize-corner) auto;
  height: var(--resize-width);
  cursor: ns-resize;
}
.window-resize-South {
  inset: auto var(--resize-corner) 0;
  height: var(--resize-width);
  cursor: ns-resize;
}
.window-resize-East {
  inset: var(--resize-corner) 0 var(--resize-corner) auto;
  width: var(--resize-width);
  cursor: ew-resize;
}
.window-resize-West {
  inset: var(--resize-corner) auto var(--resize-corner) 0;
  width: var(--resize-width);
  cursor: ew-resize;
}
.window-resize-NorthEast,
.window-resize-SouthEast,
.window-resize-SouthWest,
.window-resize-NorthWest {
  width: var(--resize-corner);
  height: var(--resize-corner);
}
.window-resize-NorthEast {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}
.window-resize-SouthEast {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
}
.window-resize-SouthWest {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}
.window-resize-NorthWest {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}
</style>
