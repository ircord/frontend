import type { InjectionKey, Ref } from 'vue'

export const tabsKey: InjectionKey<{ id: string; selected: Ref<string | undefined> }> =
  Symbol('tabs')

export const tabId = (group: string, part: 'tab' | 'panel', value: string) =>
  `${group}-${part}-${encodeURIComponent(value)}`
