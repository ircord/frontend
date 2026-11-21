import type { EmojiItem } from '../../../shared/types/media'
export interface MenuItem {
  label: string
  icon?: string
  hint?: string
  title?: string
  danger?: boolean
  disabled?: boolean
  /** Shows a check mark (radio-style choices such as notification levels). */
  checked?: boolean
  action?: () => void
  children?: MenuEntry[]
}
/** `'-'` draws a separator. */
export type MenuEntry = MenuItem | '-'
/** A row of emoji buttons above the items (quick reactions). */
export interface QuickAction {
  emoji: string
  /** A custom emoji to draw as its image instead of the text. */
  item?: EmojiItem
  label: string
  action: () => void
}

interface MenuState {
  open: boolean
  x: number
  y: number
  title: string
  /** A line under the title on phones: what the menu is about (a message's text). */
  detail: string
  items: MenuEntry[]
  quick: QuickAction[]
  /** Element to return focus to when the menu closes. */
  returnFocus: HTMLElement | null
}
const state = reactive<MenuState>({
  open: false,
  x: 0,
  y: 0,
  title: '',
  detail: '',
  items: [],
  quick: [],
  returnFocus: null,
})
/**
 * The button whose press just closed its own menu. The press closes the menu on pointerdown, so
 * the click that follows must not open it again. Cleared by the next press anywhere.
 */
let dismissedBy: HTMLElement | null = null
function clearDismissed() {
  dismissedBy = null
}

/**
 * One app-wide context menu. Open it from a `contextmenu` event, or from a button for dropdowns
 * (the menu opens below the button).
 */
export function useContextMenu() {
  function open(
    event: MouseEvent | HTMLElement,
    items: MenuEntry[],
    title = '',
    quick: QuickAction[] = [],
    detail = '',
  ) {
    const entries = items.filter(
      (item, i, all) => item !== '-' || (i > 0 && all[i - 1] !== '-' && i < all.length - 1),
    )
    if (!entries.length) return
    // A second click on the button that opened the menu closes it (the press already did).
    const trigger = event instanceof MouseEvent ? event.currentTarget : event
    if (
      dismissedBy &&
      trigger === dismissedBy &&
      !(event instanceof MouseEvent && event.type === 'contextmenu')
    ) {
      if (event instanceof MouseEvent) event.preventDefault()
      dismissedBy = null
      return
    }
    dismissedBy = null
    if (event instanceof MouseEvent) {
      event.preventDefault()
      // Keyboard-opened (Shift+F10 / menu key) events carry no pointer position.
      const target = event.currentTarget as HTMLElement | null
      const box = target?.getBoundingClientRect()
      state.x = event.clientX || (box ? box.left + 8 : 0)
      state.y = event.clientY || (box ? box.bottom : 0)
      state.returnFocus = target
    } else {
      const box = event.getBoundingClientRect()
      state.x = box.left
      state.y = box.bottom + 4
      state.returnFocus = event
    }
    state.items = entries
    state.title = title
    state.detail = detail
    state.quick = quick
    state.open = true
  }
  function close(restoreFocus = true) {
    const target = state.returnFocus
    state.open = false
    // Closed menus must not retain an old message's DOM or action closures after navigation.
    state.returnFocus = null
    state.items = []
    state.quick = []
    state.title = ''
    state.detail = ''
    if (restoreFocus && target?.isConnected) target.focus()
  }
  /** A press outside the menu: remembers when it landed on the menu's own button. */
  function pressedOutside(target: EventTarget | null) {
    const trigger = state.returnFocus
    if (!trigger || !(target instanceof Node) || !trigger.contains(target)) return
    dismissedBy = trigger
    // After this press is dispatched, so only a later press clears it.
    setTimeout(() =>
      window.addEventListener('pointerdown', clearDismissed, { capture: true, once: true }),
    )
  }
  return { state, open, close, pressedOutside }
}
