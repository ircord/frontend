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

/** Checks and decrypts a downloaded encrypted file. Throws when it was changed. */
export async function decryptFile(
  data: ArrayBuffer | Uint8Array,
  attachment: Pick<Attachment, 'key' | 'sha256'>,
) {
  const file = bytesOf(data)
  if (toHex(await sha256(file)) !== attachment.sha256) throw new Error('The file was changed.')
  const raw = fromBase64(attachment.key)
  if (raw.length !== 32 || file.length < 12 + 16) throw new Error('The file is not readable.')
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
// to the client. This client:
//
// 1. On the new device: reads the account's identity key from the key directory, makes a
//    certificate request R and a random secret S, and posts R through the backend's approval
//    relay to the account's `pending` mailbox. It shows a QR code with its device ID, the digest
//    D = SHA-256("ircord-e2ee/1 approval" || 0x00 || R || identity key) and S, and a short code
//    made from D.
// 2. On the approving device: computes D for each pending request with its own identity key. It
//    accepts the request whose D matches the scanned QR code, or the one whose short code the
//    person confirms. It certifies R and relays the certificate to the new device, with the
//    encrypted chat list and verification marks encrypted under a key derived from S (only after
//    a QR scan, since S never passes the server).
// 3. On the new device: installs the certificate only if its identity key is the one D was made
//    with. A server that swapped R or the identity key changes D, so the codes do not match.

export const APPROVAL_MAILBOX = 'pending'
const APPROVAL_LABEL = new TextEncoder().encode('ircord-e2ee/1 approval\0')

export async function approvalDigest(request: Uint8Array, identityKey: Uint8Array) {
  const input = new Uint8Array(APPROVAL_LABEL.length + request.length + identityKey.length)
  input.set(APPROVAL_LABEL)
  input.set(request, APPROVAL_LABEL.length)
  input.set(identityKey, APPROVAL_LABEL.length + request.length)
  return sha256(input)
}

/** Ten digits in two groups, from the first ten bytes of the digest: what people compare. */
export function approvalCode(digest: Uint8Array) {
  const group = (from: number) =>
    (
      Number(
        [...digest.subarray(from, from + 5)].reduce((n, b) => (n << 8n) | BigInt(b), 0n) % 100000n,
      ) + 100000
    )
      .toString()
      .slice(1)
  return `${group(0)} ${group(5)}`
}

const QR_PREFIX = 'ircord-e2ee-approve:1:'

export function approvalQr(deviceId: string, digest: Uint8Array, secret: Uint8Array) {
  return `${QR_PREFIX}${deviceId}:${toHex(digest)}:${toBase64Url(secret)}`
}

export function parseApprovalQr(text: string) {
  if (!text.startsWith(QR_PREFIX)) return undefined
  const [deviceId, digest, secret] = text.slice(QR_PREFIX.length).split(':')
  if (!deviceId || !/^[0-9a-f]{32}$/.test(deviceId) || !digest || !/^[0-9a-f]{64}$/.test(digest))
    return undefined
  if (!secret || !/^[A-Za-z0-9_-]{22}$/.test(secret)) return undefined
  return { deviceId, digest, secret: fromBase64(secret) }
}

async function handoverKey(secret: Uint8Array, usage: KeyUsage) {
  const base = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('ircord-e2ee/1 approval handover'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

export async function sealHandover(secret: Uint8Array, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await handoverKey(secret, 'encrypt'),
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  )
  const out = new Uint8Array(12 + sealed.length)
  out.set(iv)
  out.set(sealed, 12)
  return out
}

export async function openHandover(secret: Uint8Array, data: Uint8Array): Promise<unknown> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.subarray(0, 12) as BufferSource },
    await handoverKey(secret, 'decrypt'),
    data.subarray(12) as BufferSource,
  )
  return JSON.parse(new TextDecoder().decode(plain))
}
