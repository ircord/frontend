import { shallowRef, type InjectionKey, type Ref, type ShallowRef } from 'vue'
import { floatingRoot, type FloatingRoot } from '../../../composables/shared/useFloatingPanel'

interface MenuRoot extends FloatingRoot {
  parent?: MenuRoot
  submenu: ShallowRef<string>
  focusOnOpen: ShallowRef<boolean>
  closeAll: () => void
}

export function menuRoot(open: Ref<boolean>, parent?: MenuRoot): MenuRoot {
  const root = floatingRoot(open)
  return {
    ...root,
    parent,
    submenu: shallowRef(''),
    focusOnOpen: shallowRef(true),
    closeAll: () => {
      if (parent) parent.closeAll()
      else open.value = false
    },
  }
}
export const menuKey: InjectionKey<MenuRoot> = Symbol('menu')
export const menuItemSelector = 'button:is([role="menuitem"],[role="menuitemcheckbox"]):enabled'

export function menuItems(panel: HTMLElement) {
  return [...panel.querySelectorAll<HTMLButtonElement>(menuItemSelector)].filter(
    (item) => item.closest('[role="menu"]') === panel,
  )
}
