import type { Message } from '../../shared/types/chat'
import type { components } from '../../shared/generated/api'
import { readLocal, writeLocal } from './storage'

export type SendCopy = {
  message: Message
  attachments: string[]
  endpoint?: components['schemas']['SendEndpoint']
}

export function sendCopies(accountPrefix: string) {
  const prefix = `${accountPrefix}.outbox.`
  function read(key: string): SendCopy | undefined {
    if (!key.startsWith(prefix)) return
    return readLocal(key, (value) => {
      const copy = value as Partial<SendCopy> | undefined
      const m = copy?.message
      if (
        !m ||
        typeof m.clientId !== 'string' ||
        key !== prefix + m.clientId ||
        typeof m.conversationId !== 'string' ||
        typeof m.text !== 'string' ||
        typeof m.createdAt !== 'string' ||
        !Array.isArray(copy?.attachments) ||
        !copy.attachments.every((id) => typeof id === 'string')
      )
        return undefined
      return { message: m, attachments: copy.attachments, endpoint: copy.endpoint }
    })
  }
  return {
    read,
    list(): SendCopy[] {
      try {
        return Object.keys(localStorage).flatMap((key) => {
          const copy = read(key)
          return copy ? [copy] : []
        })
      } catch {
        return []
      }
    },
    save(copy: SendCopy) {
      return writeLocal(prefix + copy.message.clientId, copy)
    },
    remove(id: string) {
      try {
        localStorage.removeItem(prefix + id)
      } catch {
        // The backend's terminal state removes stale copies after recovery.
      }
    },
  }
}
