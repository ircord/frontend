import assert from 'node:assert/strict'
import test from 'node:test'
import {
  approvalCode,
  approvalDigest,
  approvalQr,
  decryptFile,
  encryptedToTag,
  encryptFile,
  fromBase64,
  fromHex,
  messagePayload,
  openHandover,
  parseApprovalQr,
  sealHandover,
  tagToEncrypted,
  toBase64,
  toBase64Url,
  toHex,
} from './codec'
import { plainTokens } from './types'

test('tag values and the backend encrypted object convert both ways', () => {
  assert.deepEqual(tagToEncrypted('1.m.AbC-_9'), {
    version: 1,
    class: 'message',
    payload: 'AbC-_9',
  })
  assert.deepEqual(tagToEncrypted('1.a.xyz'), { version: 1, class: 'auxiliary', payload: 'xyz' })
  assert.equal(encryptedToTag({ version: 1, class: 'auxiliary', payload: 'xyz' }), '1.a.xyz')
  assert.equal(encryptedToTag({ version: 1, class: 'message', payload: 'AbC' }), '1.m.AbC')
  assert.throws(() => tagToEncrypted('2.m.abc'))
  assert.throws(() => tagToEncrypted('1.x.abc'))
  assert.throws(() => tagToEncrypted('1.m.a+b'))
})

test('byte encodings round-trip', () => {
  const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) % 256)
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes)
  assert.deepEqual(fromBase64(toBase64Url(bytes)), bytes)
  assert.equal(toBase64Url(new Uint8Array([251, 255])), '-_8')
  assert.deepEqual(fromHex(toHex(bytes.subarray(0, 32))), bytes.slice(0, 32))
  assert.throws(() => fromHex('ABCD'))
})

test('message payloads carry only the fields the wire specification lists', () => {
  const plain = messagePayload({ text: 'hi' })
  assert.deepEqual(Object.keys(plain), ['v', 'id', 't', 'text'])
  assert.match(plain.id, /^[0-9a-f]{32}$/)
  const full = messagePayload({ text: 'waves', kind: 'action', reply: 'a'.repeat(32) })
  assert.deepEqual(Object.keys(full), ['v', 'id', 't', 'text', 'kind', 'reply'])
  assert.ok(!('kind' in messagePayload({ text: 'x', kind: 'message' })))
})

test('an encrypted file decrypts only with its key and unchanged bytes', async () => {
  const data = new TextEncoder().encode('a picture, really')
  const sealed = await encryptFile(data)
  assert.equal(sealed.bytes.length, 12 + data.length + 16)
  assert.match(sealed.sha256, /^[0-9a-f]{64}$/)
  assert.equal(
    new TextDecoder().decode(await decryptFile(sealed.bytes, sealed)),
    'a picture, really',
  )
  const changed = sealed.bytes.slice()
  changed[20]! ^= 1
  await assert.rejects(decryptFile(changed, sealed), /changed/)
  const other = await encryptFile(data)
  await assert.rejects(decryptFile(sealed.bytes, { ...sealed, key: other.key }))
})

test('the approval code binds the request and the identity key', async () => {
  const request = Uint8Array.from({ length: 116 }, (_, i) => i)
  const identity = Uint8Array.from({ length: 32 }, (_, i) => 255 - i)
  const digest = await approvalDigest(request, identity)
  assert.match(approvalCode(digest), /^\d{5} \d{5}$/)
  assert.equal(approvalCode(digest), approvalCode(await approvalDigest(request, identity)))
  const swappedRequest = request.slice()
  swappedRequest[3] = 0
  assert.notEqual(toHex(await approvalDigest(swappedRequest, identity)), toHex(digest))
  const swappedKey = identity.slice()
  swappedKey[0] = 0
  assert.notEqual(toHex(await approvalDigest(request, swappedKey)), toHex(digest))
})

test('the approval QR code carries the device, the digest and the secret', async () => {
  const digest = await approvalDigest(new Uint8Array(10), new Uint8Array(32))
  const secret = crypto.getRandomValues(new Uint8Array(16))
  const device = 'ab'.repeat(16)
  const parsed = parseApprovalQr(approvalQr(device, digest, secret))
  assert.equal(parsed?.deviceId, device)
  assert.equal(parsed?.digest, toHex(digest))
  assert.deepEqual(parsed?.secret, secret)
  assert.equal(parseApprovalQr('ircord-e2ee:1:deadbeef'), undefined)
  assert.equal(parseApprovalQr(`ircord-e2ee-approve:1:${device}:${toHex(digest)}`), undefined)
})

test('the approval handover opens only with the QR secret', async () => {
  const secret = crypto.getRandomValues(new Uint8Array(16))
  const sealed = await sealHandover(secret, { verified: [{ account: 'bob', identityKey: 'AA==' }] })
  assert.deepEqual(await openHandover(secret, sealed), {
    verified: [{ account: 'bob', identityKey: 'AA==' }],
  })
  await assert.rejects(openHandover(crypto.getRandomValues(new Uint8Array(16)), sealed))
})

test('search tokens are lower-case words', () => {
  assert.deepEqual(plainTokens('Hello, WORLD! hello again: été'), [
    'hello',
    'world',
    'again',
    'été',
  ])
  assert.deepEqual(plainTokens(''), [])
})
