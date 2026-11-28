import assert from 'node:assert/strict'
import test from 'node:test'
import type { Message } from '../types/chat'
import { buildEffects, presentMessage, type PresentContext } from './present'
import type { Payload, PlainRecord } from './types'

const base: Message = {
  id: 'm1',
  conversationId: 'c1',
  senderId: 'peer-member',
  text: '[encrypted message - open IRCord to read]',
  createdAt: '2026-11-28T10:00:00Z',
  kind: 'message',
  reactions: [],
  encrypted: { version: 1, class: 'message', payload: 'p1' },
}

let at = 0
const record = (
  payload: Payload,
  account = 'bob',
  extra: Partial<PlainRecord> = {},
): PlainRecord => ({
  key: `k${++at}`,
  conversationId: 'c1',
  groupId: 'g'.repeat(32),
  account,
  device: 'd',
  at,
  messageId: `m${at}`,
  payload,
  ...extra,
})

const ctx = (extra: Partial<PresentContext> = {}): PresentContext => ({
  selfAccount: 'alice',
  partnerId: 'peer-member',
  nickOf: (id) => (id === 'you' ? 'alice' : 'bob'),
  ...extra,
})

test('a decrypted message shows its text, and the placeholder never does', () => {
  const r = record({ v: 1, id: 'a'.repeat(32), t: 'msg', text: 'hello' })
  const shown = presentMessage(base, ctx({ record: r }))
  assert.equal(shown?.text, 'hello')
  assert.deepEqual(shown?.e2ee, { state: 'ok', innerId: 'a'.repeat(32) })
  assert.equal(presentMessage(base, ctx())?.text, '')
  assert.equal(presentMessage(base, ctx())?.e2ee?.state, 'pending')
  assert.deepEqual(presentMessage(base, ctx({ failure: 'no' }))?.e2ee, {
    state: 'failed',
    reason: 'no',
  })
})

test('auxiliary events change other messages and are not rows themselves', () => {
  const aux = {
    ...base,
    encrypted: { version: 1 as const, class: 'auxiliary' as const, payload: 'p2' },
  }
  assert.equal(presentMessage(aux, ctx()), null)
  const react = record({ v: 1, id: 'b'.repeat(32), t: 'react', target: 'x', emoji: '👍' })
  assert.equal(presentMessage(aux, ctx({ record: react })), null)
  const part = record({ v: 1, id: 'c'.repeat(32), t: 'msg', text: 'a' }, 'bob', { hidden: true })
  assert.equal(presentMessage(base, ctx({ record: part })), null)
})

test('edits count only from the author, and reactions follow add and remove', () => {
  const target = record({ v: 1, id: 't'.repeat(32), t: 'msg', text: 'first' }, 'bob')
  const records = [
    target,
    record(
      { v: 1, id: '1'.repeat(32), t: 'edit', target: 't'.repeat(32), text: 'forged' },
      'alice',
    ),
    record({ v: 1, id: '2'.repeat(32), t: 'edit', target: 't'.repeat(32), text: 'second' }, 'bob'),
    record({ v: 1, id: '3'.repeat(32), t: 'react', target: 't'.repeat(32), emoji: '👍' }, 'alice'),
    record({ v: 1, id: '4'.repeat(32), t: 'react', target: 't'.repeat(32), emoji: '🎉' }, 'bob'),
    record(
      { v: 1, id: '5'.repeat(32), t: 'react', target: 't'.repeat(32), emoji: '🎉', remove: true },
      'bob',
    ),
  ]
  const shown = presentMessage(base, ctx({ record: target, effects: buildEffects(records) }))
  assert.equal(shown?.text, 'second')
  assert.equal(shown?.originalText, 'first')
  assert.deepEqual(shown?.reactions, [{ emoji: '👍', memberIds: ['you'] }])
})

test('a reply quotes the decrypted message it names, by its payload ID', () => {
  const quoted = record({ v: 1, id: 'q'.repeat(32), t: 'msg', text: 'the question' }, 'alice')
  const answer = record({
    v: 1,
    id: 'r'.repeat(32),
    t: 'msg',
    text: 'the answer',
    reply: 'q'.repeat(32),
  })
  const shown = presentMessage(
    base,
    ctx({ record: answer, effects: buildEffects([quoted, answer]) }),
  )
  assert.deepEqual(shown?.replyTo, { id: quoted.messageId!, nick: 'alice', text: 'the question' })
})

test('control events show who turned encryption on or off', () => {
  const on = record({ v: 1, id: 'o'.repeat(32), t: 'control', op: 'encryption-on' }, 'bob')
  const shownOn = presentMessage(base, ctx({ record: on }))?.e2ee
  assert.equal(shownOn?.control, 'encryption-on')
  assert.equal(shownOn?.controlBy, 'peer')
  const off = record({ v: 1, id: 'f'.repeat(32), t: 'control', op: 'encryption-off' }, 'alice', {
    own: true,
  })
  const shownOff = presentMessage(base, ctx({ record: off }))?.e2ee
  assert.equal(shownOff?.control, 'encryption-off')
  assert.equal(shownOff?.controlBy, 'you')
})

test('plaintext after encryption was turned on is marked, earlier plaintext is not', () => {
  const plain: Message = {
    ...base,
    encrypted: undefined,
    text: 'hi',
    createdAt: '2026-11-28T10:00:00Z',
  }
  const conversation = { conversationId: 'c1', groupId: 'g', peer: 'bob', on: true }
  const turnedOn = Date.parse('2026-11-28T09:00:00Z')
  assert.deepEqual(
    presentMessage(plain, ctx({ conversation: { ...conversation, at: turnedOn } }))?.e2ee,
    { state: 'plain' },
  )
  const later = Date.parse('2026-11-28T11:00:00Z')
  assert.equal(presentMessage(plain, ctx({ conversation: { ...conversation, at: later } })), plain)
  assert.equal(
    presentMessage(plain, ctx({ conversation: { ...conversation, on: false, at: turnedOn } })),
    plain,
  )
})
