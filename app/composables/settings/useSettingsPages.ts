import type { InjectionKey } from 'vue'
import { useMediaQuery } from '@vueuse/core'

/**
 * On phones a settings-style dialog (SettingsLayout) shows one page at a time: the section list,
 * then one section under the dialog bar with Back. Browser Back steps from a section to the list,
 * then closes the dialog. Wider screens show the list beside the section and ignore this.
 *
 * `startOnList` is false when the dialog opens on a chosen section or setting.
 */
export function useSettingsPages(key: string, startOnList = true) {
  const phone = useMediaQuery('(max-width: 700px)')
  const list = ref(startOnList)
  useViewHistory(`${key}-page`, list)
  // The page before a section is the list, unless the dialog opened on that section.
  let fromList = false
  // No slide when the dialog first appears; only moves between pages animate.
  const moved = ref(false)
  watch(list, (value) => {
    fromList = !value
    moved.value = true
  })
  /** Shows the section that was chosen (phones only; wider screens already show it). */
  function show() {
    if (phone.value && list.value) list.value = false
  }
  /** Back to the list, through history when the list is the previous page. */
  function back() {
    if (fromList) window.history.back()
    else list.value = true
  }
  provide(settingsPagesKey, { show })
  return reactive({
    view: computed(() => (!phone.value ? 'both' : list.value ? 'list' : 'section')),
    /** A section fills the dialog; its bar shows the section name and Back. */
    inSection: computed(() => phone.value && !list.value),
    phone,
    moved,
    show,
    back,
  })
}

export type SettingsPages = ReturnType<typeof useSettingsPages>

export const settingsPagesKey: InjectionKey<{ show: () => void }> = Symbol('settings-pages')
