import { acceptHMRUpdate, defineStore } from 'pinia'
import { useQuery, useQueryCache } from '@pinia/colada'
import {
  compileAppearance,
  defaultAppearance,
  optionalAttributes,
  sanitizeAppearance,
  type Appearance,
} from '../../shared/appearance'
import { compiledAppearanceKey } from '../../shared/appearance-boot'
import type { SchemeMode } from '../../shared/schemes'

interface LocalAppearance {
  settings: Appearance
  /** Server revision these settings came from or were last saved as. */
  revision: string | null
  /** Edited here and not confirmed by the server yet. */
  dirty: boolean
  /** Follow the account's appearance; when off this device keeps its own look. */
  sync: boolean
}
const localKey = 'ircord.appearance'
const readStored = (): LocalAppearance =>
  readLocal(localKey, (value) => {
    const v = (value && typeof value === 'object' ? value : {}) as Partial<LocalAppearance>
    return {
      settings: sanitizeAppearance(v.settings ?? defaultAppearance),
      revision: typeof v.revision === 'string' ? v.revision : null,
      dirty: v.dirty === true,
      sync: v.sync !== false,
    }
  })

function themeStyle(id: string) {
  const style = document.querySelector<HTMLStyleElement>(`style#${id}`) ?? document.createElement('style')
  // Tauri's policy authorizes inline styles with the nonce on the bundled stylesheet.
  const nonce = document.head.querySelector<HTMLStyleElement>('style[nonce]')?.nonce
  if (nonce) style.nonce = nonce
  style.id = id
  return style
}

/**
 * Appearance is local-first: it applies instantly from this browser's copy, then reconciles with
 * the account copy on the server so one look follows the user to every device.
 */
export const useAppearanceStore = defineStore('appearance', () => {
  const local = reactive(readStored())
  const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const queryCache = useQueryCache()
  const remote = useQuery({
    key: ['appearance'],
    query: () => appClient.appearance(),
    enabled: () => local.sync && useAuthStore().status === 'signed-in',
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  const queue = createLatestQueue((settings: Appearance) => appClient.saveAppearance(settings), {
    delay: 400,
    onSaved: (_value, saved) => {
      queryCache.setQueryData(['appearance'], saved)
      local.revision = saved.updatedAt
      local.dirty = false
      saveState.value = 'saved'
      persist()
    },
    onError: () => (saveState.value = 'error'),
  })
  onScopeDispose(queue.dispose)
  // This also handles a sync choice received from another tab's storage event.
  watch(
    () => local.sync,
    (enabled) => {
      if (enabled) return
      queue.cancel()
      saveState.value = 'idle'
    },
    { flush: 'sync' },
  )

  // Server copy arrived: unsaved local edits win, otherwise adopt the account's look.
  watch(
    () => remote.data.value,
    (stored) => {
      if (!stored || !local.sync) return
      if (local.dirty || !stored.settings) {
        saveState.value = 'saving'
        queue.push(local.settings)
      } else if (stored.updatedAt !== local.revision) {
        local.settings = sanitizeAppearance(stored.settings)
        local.revision = stored.updatedAt
        persist()
      }
    },
  )

  function update(changes: Partial<Appearance>) {
    local.settings = sanitizeAppearance({ ...local.settings, ...changes })
    local.dirty = true
    persist()
    if (local.sync) {
      saveState.value = 'saving'
      queue.push(local.settings)
    }
  }
  function setSync(value: boolean) {
    local.sync = value
    persist()
    if (value) void remote.refetch()
  }

  // ---- Applying to the document ---------------------------------------------------------------

  const prefersLight = useMediaQuery('(prefers-color-scheme: light)')
  const prefersReduced = useMediaQuery('(prefers-reduced-motion: reduce)')

  const themes = useThemesStore()
  themes.connectAppearance({ settings: () => local.settings, update })
  /** The saved mode; the theme studio can preview the other one without saving it. */
  const mode = computed<SchemeMode>(
    () =>
      themes.previewMode ??
      (local.settings.mode === 'system'
        ? prefersLight.value
          ? 'light'
          : 'dark'
        : local.settings.mode),
  )
  const compiled = computed(() => compileAppearance(local.settings, mode.value, themes.applied))
  /** The built-in look, without a personal theme: the theme studio and recovery bars use it. */
  const baseTokens = computed(() => compileAppearance(local.settings, mode.value).tokens)
  const reducedMotion = computed(() =>
    local.settings.motion === 'system' ? prefersReduced.value : local.settings.motion === 'reduced',
  )
  /** Animated GIFs and emotes play only when the user wants them and motion is not reduced. */
  const animate = computed(() => local.settings.animateMedia && !reducedMotion.value)

  function persist() {
    writeLocal(localKey, local)
    // Both modes, so the boot script can follow the system preference before the app loads.
    writeLocal(compiledAppearanceKey, {
      mode: local.settings.mode,
      dark: pickDocument(compileAppearance(local.settings, 'dark')),
      light: pickDocument(compileAppearance(local.settings, 'light')),
    })
  }
  const pickDocument = ({ css, attrs }: { css: string; attrs: Record<string, string> }) => ({
    css,
    attrs,
  })

  watchEffect(() => {
    const { css, attrs, themeColor } = compiled.value
    const root = document.documentElement
    for (const [name, value] of Object.entries(attrs)) root.setAttribute(name, value)
    for (const name of optionalAttributes) if (!(name in attrs)) root.removeAttribute(name)
    root.dataset.motion = reducedMotion.value ? 'reduced' : 'full'
    root.style.colorScheme = mode.value
    const style = themeStyle('ircord-theme')
    if (style.textContent !== css) style.textContent = css
    if (!style.isConnected) document.head.appendChild(style)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor)
  })
  // A personal theme's custom CSS: only ever the filtered output, after every app stylesheet.
  watchEffect(() => {
    const css = themes.userCss
    if (!css) {
      document.getElementById('ircord-user-css')?.remove()
      return
    }
    const style = themeStyle('ircord-user-css')
    if (style.textContent !== css) style.textContent = css
    if (style !== document.head.lastElementChild) document.head.appendChild(style)
  })

  // Another tab changed the appearance.
  useEventListener(window, 'storage', (event) => {
    if (event.key === localKey) Object.assign(local, readStored())
  })
  persist()

  return {
    settings: computed(() => local.settings),
    sync: computed(() => local.sync),
    saveState,
    mode,
    tokens: computed(() => compiled.value.tokens),
    baseTokens,
    reducedMotion,
    animate,
    update,
    setSync,
  }
})

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useAppearanceStore, import.meta.hot))
