import type { Member } from '../../../shared/types/chat'

interface PromptRequest {
  kind: 'prompt' | 'confirm'
  title: string
  body?: string
  label?: string
  value?: string
  placeholder?: string
  confirm: string
  danger?: boolean
  /** Typing this exact text enables the confirm button (destructive actions). */
  requireText?: string
  /** An optional reason can be submitted without text. */
  allowEmpty?: boolean
  /** Asks for the account's current password; the answer is returned untrimmed. */
  password?: boolean
  /** Asks for a nickname: suggests these people as you type, like the message box's @ list. */
  people?: readonly Member[]
  /** The network's casemapping, for matching `people`. */
  caseMapping?: string
  resolve: (value: string | null) => void
}
const current = shallowRef<PromptRequest | null>(null)

/** Small in-app replacements for window.prompt/confirm, rendered by <PromptDialog>. */
export function usePrompt() {
  const ask = (request: Omit<PromptRequest, 'resolve' | 'kind'>) =>
    new Promise<string | null>((resolve) => {
      current.value?.resolve(null)
      current.value = { kind: 'prompt', ...request, resolve }
    })
  const confirm = (
    request: Omit<PromptRequest, 'resolve' | 'kind' | 'label' | 'value' | 'placeholder'>,
  ) =>
    new Promise<boolean>((resolve) => {
      current.value?.resolve(null)
      current.value = { kind: 'confirm', ...request, resolve: (value) => resolve(value !== null) }
    })
  function settle(value: string | null) {
    const request = current.value
    current.value = null
    request?.resolve(value)
  }
  return { current, ask, confirm, settle }
}
