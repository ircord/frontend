/**
 * How the timeline shows messages of an encrypted conversation (experimental, ircord/issues#19).
 * The server holds only ciphertext and a placeholder body; this turns a message and this
 * device's decrypted record of it into what people read. Edits and reactions travel as their own
 * encrypted events and are applied here to the message they name.
 */
import type { Message } from '../types/chat'
import type { Attachment, ConversationRecord, PlainRecord } from './types'

/** What a presented message carries about its encryption. */
export interface E2eePresentation {
  /**
   * `ok`: decrypted. `pending`: waiting to decrypt. `failed`: this device cannot read it.
   * `plain`: it arrived unencrypted in an encrypted conversation.
   */
  state: 'ok' | 'pending' | 'failed' | 'plain'
  reason?: string
  /** The payload ID, which replies, edits and reactions refer to. */
  innerId?: string
  /** A control event: encryption was turned on or off, by you or the other person. */
  control?: 'encryption-on' | 'encryption-off'
  controlBy?: 'you' | 'peer'
  /** Files to fetch and decrypt; the server never sees their names or keys. */
  attachments?: Attachment[]
}

export interface ConversationEffects {
  /** `msg` records by payload ID. */
  byInner: Map<string, PlainRecord>
  /** The newest edit of each message by its own author. */
  edits: Map<string, { text: string; at: number }>
  /** Reactions on each message: emoji to the accounts that reacted. */
  reactions: Map<string, Map<string, Set<string>>>
}

const fold = (account: string) => account.toLowerCase()

/** Collects edits and reactions from a conversation's records, oldest first. */
export function buildEffects(records: readonly PlainRecord[]): ConversationEffects {
  const sorted = [...records].sort((a, b) => a.at - b.at)
  const byInner = new Map<string, PlainRecord>()
  for (const r of sorted) if (r.payload?.t === 'msg') byInner.set(r.payload.id, r)
  const edits = new Map<string, { text: string; at: number }>()
  const reactions = new Map<string, Map<string, Set<string>>>()
  for (const r of sorted) {
    const p = r.payload
    if (!p) continue
    if (p.t === 'edit') {
      const target = byInner.get(p.target)
      // Only the author edits a message: compared by the MLS sender of both events.
      if (target && fold(target.account) === fold(r.account))
        edits.set(p.target, { text: p.text, at: r.at })
    } else if (p.t === 'react') {
      if (!byInner.has(p.target)) continue
      const emojis = reactions.get(p.target) ?? new Map<string, Set<string>>()
      const people = emojis.get(p.emoji) ?? new Set<string>()
      if (p.remove) people.delete(fold(r.account))
      else people.add(fold(r.account))
      if (people.size) emojis.set(p.emoji, people)
      else emojis.delete(p.emoji)
      reactions.set(p.target, emojis)
    }
  }
  return { byInner, edits, reactions }
}

export interface PresentContext {
  record?: PlainRecord
  failure?: string
  effects?: ConversationEffects
  conversation?: ConversationRecord
  selfAccount: string
  /** The other person's member ID, for reactions and reply quotes. */
  partnerId?: string
  nickOf: (memberId: string) => string
}

const shown = new Set(['message', 'action', 'notice'])

export function presentMessage(message: Message, ctx: PresentContext): Message | null {
  if (!message.encrypted) {
    const since = ctx.conversation?.on ? ctx.conversation.at : undefined
    // Plaintext after encryption was turned on: shown, and marked.
    if (
      since &&
      shown.has(message.kind) &&
      !message.delivery &&
      Date.parse(message.createdAt) > since
    )
      return { ...message, e2ee: { state: 'plain' } }
    return message
  }
  const record = ctx.record
  // A reaction, edit or control event this device cannot read changes nothing it shows.
  if (!record && message.encrypted.class === 'auxiliary') return null
  if (!record)
    return {
      ...message,
      text: '',
      reactions: [],
      e2ee: ctx.failure ? { state: 'failed', reason: ctx.failure } : { state: 'pending' },
    }
  const p = record.payload
  if (record.hidden || !p) return null
  const memberOf = (account: string) =>
    fold(account) === fold(ctx.selfAccount) || (record.own && account === record.account)
      ? 'you'
      : (ctx.partnerId ?? '')
  if (p.t === 'control')
    return {
      ...message,
      kind: 'notice',
      text: '',
      reactions: [],
      e2ee: {
        state: 'ok',
        innerId: p.id,
        control: p.op,
        controlBy: record.own || fold(record.account) === fold(ctx.selfAccount) ? 'you' : 'peer',
      },
    }
  if (p.t !== 'msg') return null
  const edit = ctx.effects?.edits.get(p.id)
  const reactions = [...(ctx.effects?.reactions.get(p.id) ?? new Map<string, Set<string>>())].map(
    ([emoji, accounts]) => ({ emoji, memberIds: [...accounts].map(memberOf) }),
  )
  const target = p.reply ? ctx.effects?.byInner.get(p.reply) : undefined
  const targetText = target?.payload?.t === 'msg' ? target.payload.text : ''
  const {
    attachment: _attachment,
    attachments: _attachments,
    gif: _gif,
    replyTo: _reply,
    ...rest
  } = message
  return {
    ...rest,
    text: edit?.text ?? p.text,
    kind: p.kind === 'action' ? 'action' : 'message',
    reactions,
    ...(edit && { editedAt: new Date(edit.at).toISOString(), originalText: p.text }),
    ...(p.reply && {
      replyTo: {
        id: target?.messageId ?? '',
        nick: target ? ctx.nickOf(memberOf(target.account)) : '',
        text: (ctx.effects?.edits.get(p.reply)?.text ?? targetText).slice(0, 160),
      },
    }),
    e2ee: {
      state: 'ok',
      innerId: p.id,
      ...(p.attachments?.length && { attachments: p.attachments }),
    },
  }
}
