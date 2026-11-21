import type { InjectionKey, Ref } from 'vue'

export type RadioValue = string | number

export interface RadioChoice {
  checked: Readonly<Ref<boolean>>
  disabled: Readonly<Ref<boolean>>
}

export const radioGroupKey: InjectionKey<{
  value: Readonly<Ref<RadioValue | undefined>>
  disabled: () => boolean
  tabStop: Readonly<Ref<RadioChoice | undefined>>
  register: (choice: RadioChoice) => () => void
  select: (value: RadioValue) => void
}> = Symbol('radio group')
