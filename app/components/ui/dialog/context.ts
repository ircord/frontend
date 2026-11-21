import type { InjectionKey, Ref } from 'vue'
export const dialogKey: InjectionKey<{ open: Ref<boolean>; titleId: string }> = Symbol('dialog')
