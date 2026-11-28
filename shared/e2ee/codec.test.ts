import assert from 'node:assert/strict'
import test from 'node:test'
import {
  approvalQr,
  decryptFile,
  encryptedToTag,
  encryptFile,
  formatApprovalCode,
  fromBase64,
  fromHex,
  messagePayload,
  newApprovalCode,
  normalizeApprovalCode,
  openApprovalRequest,
  openHandover,
  parseApprovalQr,
  sealApprovalRequest,
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

test('approval codes are 20 random digits, read and typed in groups', () => {
  const code = newApprovalCode()
  assert.match(code, /^\d{20}$/)
  assert.notEqual(newApprovalCode(), code)
  assert.match(formatApprovalCode(code), /^\d{5} \d{5} \d{5} \d{5}$/)
  assert.equal(normalizeApprovalCode(formatApprovalCode(code)), code)
  assert.equal(normalizeApprovalCode('12345 67890'), undefined)
  assert.equal(parseApprovalQr(approvalQr(code)), code)
  assert.equal(parseApprovalQr(`ircord-e2ee-approve:1:${code}`), undefined)
})

test('only the holder of the code can make a request the approving device accepts', async () => {
  const code = newApprovalCode()
  const request = Uint8Array.from({ length: 116 }, (_, i) => i)
  const posted = await sealApprovalRequest(code, request)
  assert.deepEqual(await openApprovalRequest(code, posted), request)
  // A server that swaps the request, or does not know the code, is refused.
  const swapped = posted.slice()
  swapped[3]! ^= 1
  assert.equal(await openApprovalRequest(code, swapped), undefined)
  assert.equal(await openApprovalRequest(newApprovalCode(), posted), undefined)
  const forged = await sealApprovalRequest(newApprovalCode(), request)
  assert.equal(await openApprovalRequest(code, forged), undefined)
})

test('the approval answer opens only with the code', async () => {
  const code = newApprovalCode()
  const sealed = await sealHandover(code, { certificate: 'AA==', verified: [] })
  assert.deepEqual(await openHandover(code, sealed), { certificate: 'AA==', verified: [] })
  await assert.rejects(openHandover(newApprovalCode(), sealed))
  const changed = sealed.slice()
  changed[20]! ^= 1
  await assert.rejects(openHandover(code, changed))
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
