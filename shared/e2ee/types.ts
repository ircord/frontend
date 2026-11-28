/**
 * End-to-end encryption in the web client (experimental, ircord/issues#19): the records the
 * encryption worker keeps per account in IndexedDB, and the payload shapes of the wire
 * specification (github.com/ircord/e2ee, docs/wire.md section 6).
 */

/** One IndexedDB database per account: the device state and the local store of decrypted messages. */
export const E2EE_DB_PREFIX = 'ircord-e2ee-'

/** What the worker reports about this device's keys. */
export interface E2eeStatus {
  device: boolean
  account?: string
  deviceId?: string
  /** This device holds the account's identity key, so it can approve other devices. */
  holdsIdentity?: boolean
  /** This device has a certificate from the identity key: it can join and read encrypted chats. */
  certified?: boolean
  identityKey?: Uint8Array
}

/** An error from the core or the worker. `code` is the core's, such as `identity-changed`. */
export interface E2eeErrorShape {
  code: string
  message: string
  account?: string
  presented?: Uint8Array
}

export interface Attachment {
  url: string
  /** AES-256-GCM key, base64url. The file is the 12-byte IV followed by the ciphertext. */
  key: string
  /** Hex SHA-256 of the encrypted file as uploaded. */
  sha256: string
  name: string
  mime: string
  size: number
  width?: number
  height?: number
}

export interface Gif {
  url: string
  width?: number
  height?: number
  title?: string
}

/** A decrypted payload. Unknown fields are kept but ignored. */
export type Payload = { v: 1; id: string; part?: { i: number; n: number } } & (
  | {
      t: 'msg'
      text: string
      kind?: 'message' | 'action'
      reply?: string
      attachments?: Attachment[]
      gif?: Gif
    }
  | { t: 'react'; target: string; emoji: string; remove?: boolean }
  | { t: 'edit'; target: string; text: string }
  | { t: 'delete'; target: string }
  | { t: 'control'; op: 'encryption-on' | 'encryption-off' | 'left' }
)

/** One decrypted (or self-sent) ciphertext, keyed by the SHA-256 of its base64url payload. */
export interface PlainRecord {
  key: string
  conversationId: string
  groupId: string
  /** The sender's account, from the certificate MLS verified (or this device's own). */
  account: string
  device: string
  /** The message's time in milliseconds, for ordering and search. */
  at: number
  /** The server's message ID once known. */
  messageId?: string
  /** Absent for a part that is not the last one of a split message. */
  payload?: Payload
  /** A part of a longer message that the last part shows in full. */
  hidden?: boolean
  /** Sent from this device. */
  own?: boolean
  /** Lower-case words of the text, for local search. */
  tokens?: string[]
}

/**
 * This device's own record of a conversation's encryption: a direct conversation, or an
 * encrypted group's channel. A device trusts this list, not the server, to decide whether a
 * conversation is encrypted.
 */
export interface ConversationRecord {
  conversationId: string
  /** The MLS group ID (32 hex digits). */
  groupId: string
  /** The other person's account in a direct conversation; '' in a group. */
  peer: string
  on: boolean
  /** Who turned encryption on or off last, and when (milliseconds). */
  by?: string
  at?: number
  /** `group`: an encrypted group in its own channel. Absent: a direct conversation. */
  kind?: 'group'
  /**
   * `irc`: commits and Welcomes travel over IRC (the /e2ee/chats operations), so the people can be
   * on different IRCord servers. Absent: the server's own log, for direct chats of phase 1.
   */
  transport?: 'irc'
  /** A group's title, as its MLS state says. */
  title?: string
}

/** One line of an encrypted group's timeline, from a commit this device applied. */
export interface GroupEventRecord {
  /** The group, the epoch and the line's position in that commit. */
  id: string
  groupId: string
  /** When this device applied the commit, in milliseconds. */
  at: number
  kind:
    | 'added'
    | 'removed'
    | 'left'
    | 'device-added'
    | 'device-removed'
    | 'admin'
    | 'not-admin'
    | 'title'
    | 'created'
    | 'joined'
    | 'removed-you'
  /** The account that made the change. */
  by: string
  /** The account it concerns, or the new title. */
  subject?: string
}

/** How a group's members and settings look to this device, read from MLS. */
export interface GroupView {
  groupId: string
  title: string
  creator: string
  admins: string[]
  /** Each account in the group with its device IDs (hex). */
  members: { account: string; devices: string[] }[]
}

/** The text form of group IDs on the server: base64url of the 16 bytes; the core uses hex. */
export function groupIdToServer(hex: string) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function groupIdFromServer(id: string) {
  const plain = atob(id.replace(/-/g, '+').replace(/_/g, '/'))
  return [...plain].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
}

/** The channel of an encrypted group: `#e2ee-` and its ID in lowercase hex. */
export const GROUP_CHANNEL_PREFIX = '#e2ee-'
export const groupChannel = (hex: string) => `${GROUP_CHANNEL_PREFIX}${hex}`
/**
 * The group ID (hex) a channel name stands for, or '' when it is not a group's channel. The
 * name may come with or without its `#`, as conversations carry it without.
 */
export function groupOfChannel(name: string) {
  const lower = `#${name.toLowerCase().replace(/^#/, '')}`
  if (!lower.startsWith(GROUP_CHANNEL_PREFIX)) return ''
  const hex = lower.slice(GROUP_CHANNEL_PREFIX.length)
  return /^[0-9a-f]{32}$/.test(hex) ? hex : ''
}

/** A warning this device keeps until the person acknowledges it. */
export interface NoticeRecord {
  id: string
  kind: 'identity-changed'
  account: string
  /** The identity key the directory now presents. */
  presented: Uint8Array
  at: number
}

/** Lower-case words of a text, for prefix search. */
export function plainTokens(text: string) {
  const words = text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0 && w.length <= 64)
  return [...new Set(words)].slice(0, 200)
}

/** An upload made for an encrypted conversation: the server holds only the encrypted file. */
export type EncryptedUpload = import('../types/chat').Upload & { e2ee?: Attachment }
