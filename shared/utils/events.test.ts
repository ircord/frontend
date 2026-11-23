import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Message } from '../types/chat'
import { chatterSummary, isChatter, isStatusModeChange } from './events'

const event = (id: string, type: 'join' | 'mode', text?: string): Message => ({
  id,
  senderId: 'a',
  conversationId: 'room',
  text: id,
  kind: 'event',
  createdAt: new Date(2026, 0, 1, 12).toISOString(),
  reactions: [],
  event: { type, actorId: 'a', text },
})

test('isStatusModeChange accepts only changes to people’s channel status', () => {
  for (const text of ['+o sage', '-o nick', '+o-v a b', '+ov a b', '-o+v a b'])
    assert.equal(isStatusModeChange(text), true, text)
  for (const text of ['+m', '+mo sage', '+b nick!*@*', '+l 5', '+k key', '', '+', undefined])
    assert.equal(isStatusModeChange(text), false, String(text))
  assert.equal(isStatusModeChange('+q nick', 'ov'), false)
  assert.equal(isStatusModeChange('+h nick', 'qahov'), true)
})

test('isChatter treats status modes as activity and channel modes as standalone', () => {
  assert.equal(isChatter(event('a', 'mode', '+o sage')), true)
  assert.equal(isChatter(event('b', 'mode', '+m')), false)
  assert.equal(isChatter(event('c', 'join')), true)
})

test('chatterSummary counts mode events as status changes', () => {
  const summary = chatterSummary(
    [event('j', 'join'), event('o', 'mode', '+o sage'), event('v', 'mode', '-v noah')],
    (id) => id,
  )
  assert.match(summary, /a joined/)
  assert.match(summary, /2 status changes/)
})
