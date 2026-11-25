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
import { fadesBetween, quietSince, type AppliedAppearance } from '../utils/theme-fade'

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

  // The newest look to write. A fading write runs a moment after it was asked for, so it writes
  // whatever is newest by then and never an older one.
  let latest: {
    css: string
    userCss: string
    attrs: Record<string, string>
    themeColor: string
    reduced: boolean
    mode: SchemeMode
  }
  function writeAppearance() {
    const { css, userCss, attrs, themeColor, reduced, mode: scheme } = latest
    const root = document.documentElement
    for (const [name, value] of Object.entries(attrs)) root.setAttribute(name, value)
    for (const name of optionalAttributes) if (!(name in attrs)) root.removeAttribute(name)
    root.dataset.motion = reduced ? 'reduced' : 'full'
    root.style.colorScheme = scheme
    const style = themeStyle('ircord-theme')
    if (style.textContent !== css) style.textContent = css
    if (!style.isConnected) document.head.appendChild(style)
    // A personal theme's custom CSS: only ever the filtered output, after every app stylesheet.
    // It is written with the rest, so it is part of the fade's "after" picture.
    if (!userCss) document.getElementById('ircord-user-css')?.remove()
    else {
      const custom = themeStyle('ircord-user-css')
      if (custom.textContent !== userCss) custom.textContent = userCss
      if (custom !== document.head.lastElementChild) document.head.appendChild(custom)
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor)
  }
  let applied: AppliedAppearance | undefined
  let fadeStartedAt: number | undefined
  // A change of colours cross-fades over a fifth of a second: the browser blends a picture of the
  // page before with one after, which costs the same however many elements there are. Colours
  // that script derives from the theme (name colours, diagrams) switch at the start. While it
  // runs the browser does not hit-test the page, so a press anywhere ends the fade at once.
  // Where it can't fade, or the reader wants less motion, or the previous fade has only just begun
  // (a colour picker being dragged), the write is immediate, as it always was.
  watchEffect(() => {
    const { css, attrs, themeColor } = compiled.value
    const userCss = themes.userCss ?? ''
    latest = { css, userCss, attrs, themeColor, reduced: reducedMotion.value, mode: mode.value }
    const previous = applied
    applied = { css, attrs, userCss }
    const now = performance.now()
    if (
      previous &&
      !latest.reduced &&
      typeof document.startViewTransition === 'function' &&
      document.visibilityState === 'visible' &&
      quietSince(fadeStartedAt, now) &&
      fadesBetween(previous, applied)
    ) {
      fadeStartedAt = now
      const transition = document.startViewTransition(writeAppearance)
      const skip = () => transition.skipTransition()
      window.addEventListener('pointerdown', skip, { capture: true, once: true })
      void transition.ready.catch(() => undefined)
      void transition.finished
        .catch(() => undefined)
        .finally(() => window.removeEventListener('pointerdown', skip, { capture: true }))
      return
    }
    writeAppearance()
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
