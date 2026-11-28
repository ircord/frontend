/**
 * Byte encodings and small cryptographic steps of the web client's encryption (experimental,
 * ircord/issues#19) that run outside the core: tag values, file encryption, and the device
 * approval code. All of it uses the Web Crypto API, which browsers and Bun provide.
 */
import type { Attachment, Payload } from './types'

/** Standard base64 with padding: how the backend's JSON carries byte fields. */
export function toBase64(bytes: Uint8Array) {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

export function fromBase64(text: string) {
  const plain = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(plain, (c) => c.charCodeAt(0))
}

/** base64url without padding (RFC 4648 section 5), as the wire format uses. */
export function toBase64Url(bytes: Uint8Array) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function toHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(hex: string) {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error('not lowercase hex')
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16))
}

export type EncryptedField = { version: 1; class: 'message' | 'auxiliary'; payload: string }

/** A core tag value `1.<m|a>.<payload>` as the backend's `encrypted` object. */
export function tagToEncrypted(tag: string): EncryptedField {
  const match = /^1\.([ma])\.([A-Za-z0-9_-]+)$/.exec(tag)
  if (!match) throw new Error('not an encrypted message tag')
  return { version: 1, class: match[1] === 'm' ? 'message' : 'auxiliary', payload: match[2]! }
}

/** The backend's `encrypted` object back to the tag value the core reads. */
export function encryptedToTag(e: { version: number; class: string; payload: string }) {
  return `${e.version}.${e.class === 'auxiliary' ? 'a' : 'm'}.${e.payload}`
}

/** A new random payload ID: 16 bytes as 32 hex digits. */
export function newPayloadId() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)))
}

/** A `msg` payload with only the fields the wire specification lists, in its order. */
export function messagePayload(fields: {
  text: string
  kind?: 'message' | 'action'
  reply?: string
  attachments?: Attachment[]
  gif?: { url: string; width?: number; height?: number; title?: string }
}): Payload {
  return {
    v: 1,
    id: newPayloadId(),
    t: 'msg',
    text: fields.text,
    ...(fields.kind === 'action' && { kind: 'action' as const }),
    ...(fields.reply && { reply: fields.reply }),
    ...(fields.attachments?.length && { attachments: fields.attachments }),
    ...(fields.gif && { gif: fields.gif }),
  }
}

const bytesOf = (data: ArrayBuffer | Uint8Array) =>
  data instanceof Uint8Array ? data : new Uint8Array(data)

async function sha256(data: ArrayBuffer | Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytesOf(data) as BufferSource))
}

/**
 * Encrypts a file for upload with a fresh AES-256-GCM key. The uploaded file is the 12-byte IV
 * followed by the ciphertext; the key and the hash of the uploaded bytes travel inside the
 * encrypted message, so the server stores only an opaque blob.
 */
export async function encryptFile(data: ArrayBuffer | Uint8Array) {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytesOf(data) as BufferSource),
  )
  const file = new Uint8Array(iv.length + sealed.length)
  file.set(iv)
  file.set(sealed, iv.length)
  return { bytes: file, key: toBase64Url(raw), sha256: toHex(await sha256(file)) }
}

/**
 * The 32-byte key of an attachment, or undefined unless the text is canonical base64url: 43
 * characters, no padding and zero trailing bits (wire.md section 6.4).
 */
function fileKey(text: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return undefined
  const raw = fromBase64(text)
  return raw.length === 32 && toBase64Url(raw) === text ? raw : undefined
}

/** Checks and decrypts a downloaded encrypted file. Throws when it was changed. */
export async function decryptFile(
  data: ArrayBuffer | Uint8Array,
  attachment: Pick<Attachment, 'key' | 'sha256'>,
) {
  const file = bytesOf(data)
  if (toHex(await sha256(file)) !== attachment.sha256) throw new Error('The file was changed.')
  const raw = fileKey(attachment.key)
  if (!raw || file.length < 12 + 16) throw new Error('The file is not readable.')
  const key = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
    'decrypt',
  ])
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: file.subarray(0, 12) as BufferSource },
      key,
      file.subarray(12) as BufferSource,
    ),
  )
}

// ---- Device approval ------------------------------------------------------------------------
//
// A new device asks an approved device of the same account for a certificate. The core makes the
// certificate request and the certificate (wire.md sections 3.1 and 3.2); how they travel is left
// to the client. Everything here travels through the backend's approval relay, so the server
// sees it all, except the approval code: 20 random digits that the new device shows (as text and
// in a QR code) and the person carries to the approving device by scanning or typing.
//
// 1. The new device makes a certificate request R and posts R || HMAC(code, R) to the account's
//    `pending` mailbox.
// 2. The approving device takes the code from the person and certifies only a request whose HMAC
//    checks out under it. A server cannot make one: it does not know the code, and an HMAC over
//    66 random bits cannot be guessed within the relay's ten-minute lifetime. The approving device
//    sends back the certificate, its verification marks and its list of encrypted chats, sealed
//    with AES-GCM under a key derived from the code.
// 3. The new device installs only a certificate that arrives sealed under its code, so it never
//    takes an identity key from the server.

export const APPROVAL_MAILBOX = 'pending'
export const APPROVAL_DIGITS = 20
const encoder = new TextEncoder()

/** A new approval code: 20 uniformly random decimal digits. */
export function newApprovalCode() {
  let code = ''
  while (code.length < APPROVAL_DIGITS)
    for (const byte of crypto.getRandomValues(new Uint8Array(32)))
      if (byte < 250 && code.length < APPROVAL_DIGITS) code += String(byte % 10)
  return code
}

/** The code in groups of five digits, as people read and type it. */
export const formatApprovalCode = (code: string) => code.replace(/(\d{5})(?=\d)/g, '$1 ')

/** The 20 digits of a typed or scanned code, or undefined when it is not one. */
export function normalizeApprovalCode(input: string) {
  const digits = input.replace(/[\s-]/g, '')
  return new RegExp(`^\\d{${APPROVAL_DIGITS}}$`).test(digits) ? digits : undefined
}

const QR_PREFIX = 'ircord-e2ee-approve:2:'

export const approvalQr = (code: string) => `${QR_PREFIX}${code}`

/** The approval code in a scanned QR code, or undefined when it is not one. */
export function parseApprovalQr(text: string) {
  return text.startsWith(QR_PREFIX)
    ? normalizeApprovalCode(text.slice(QR_PREFIX.length))
    : undefined
}

async function approvalKey(
  code: string,
  info: string,
  algorithm: HmacImportParams | AesKeyAlgorithm,
  usages: KeyUsage[],
) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(code), 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: encoder.encode(info) },
    base,
    algorithm,
    false,
    usages,
  )
}

const macKey = (code: string, usage: KeyUsage) =>
  approvalKey(
    code,
    'ircord-e2ee/1 approval request',
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    [usage],
  )

/** What the new device posts: the certificate request followed by its 32-byte HMAC. */
export async function sealApprovalRequest(code: string, request: Uint8Array) {
  const tag = new Uint8Array(
    await crypto.subtle.sign('HMAC', await macKey(code, 'sign'), request as BufferSource),
  )
  const out = new Uint8Array(request.length + tag.length)
  out.set(request)
  out.set(tag, request.length)
  return out
}

/** The certificate request in a posted message, if it was made with this code. */
export async function openApprovalRequest(code: string, message: Uint8Array) {
  if (message.length <= 32) return undefined
  const request = message.subarray(0, message.length - 32)
  const valid = await crypto.subtle.verify(
    'HMAC',
    await macKey(code, 'verify'),
    message.subarray(message.length - 32) as BufferSource,
    request as BufferSource,
  )
  return valid ? request.slice() : undefined
}

const handoverKey = (code: string, usage: KeyUsage) =>
  approvalKey(code, 'ircord-e2ee/1 approval handover', { name: 'AES-GCM', length: 256 }, [usage])

/** Seals the approving device's answer under the approval code. */
export async function sealHandover(code: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await handoverKey(code, 'encrypt'),
      encoder.encode(JSON.stringify(value)),
    ),
  )
  const out = new Uint8Array(12 + sealed.length)
  out.set(iv)
  out.set(sealed, 12)
  return out
}

/** Opens an answer sealed under the approval code; throws for anything else. */
export async function openHandover(code: string, data: Uint8Array): Promise<unknown> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.subarray(0, 12) as BufferSource },
    await handoverKey(code, 'decrypt'),
    data.subarray(12) as BufferSource,
  )
  return JSON.parse(new TextDecoder().decode(plain))
}
