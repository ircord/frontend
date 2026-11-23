import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Message } from '../../shared/types/chat'
import { createTimelineRows } from './timeline-rows'

function message(id: string, minute: number, extra: Partial<Message> = {}): Message {
  return {
    id,
    senderId: 'a',
    conversationId: 'room',
    text: id,
    kind: 'message',
    createdAt: new Date(2026, 0, 1, 12, minute).toISOString(),
    reactions: [],
    ...extra,
  }
}

test('new arrivals reuse existing rows and trimming recomputes the first row', () => {
  const build = createTimelineRows()
  const first = message('first', 0)
  const second = message('second', 1)
  const arrival = message('arrival', 2)
  const before = build([first, second], false)
  const after = build([first, second, arrival], false)
  assert.equal(after[0], before[0])
  assert.equal(after[1], before[1])
  assert.equal(after[1]?.kind === 'message' && after[1].grouped, true)
  assert.equal(build([first, second, arrival], false), after)
  const trimmed = build([second, arrival], false)
  assert.equal(trimmed[0]?.dayBreak, true)
  assert.equal(trimmed[0]?.kind === 'message' && trimmed[0].grouped, false)
  assert.equal(trimmed[1], after[2])
})

test('only a changed event run gets replaced, and hidden authors do not group messages', () => {
  const build = createTimelineRows()
  const join = (id: string, minute: number) =>
    message(id, minute, { kind: 'event', event: { type: 'join', actorId: 'a' } })
  const first = message('first', 0)
  const one = join('one', 1)
  const two = join('two', 2)
  const three = join('three', 3)
  const speech = message('speech', 4)
  const before = build([first, one, two, speech], false)
  const after = build([first, one, two, three, speech], false)
  const oldRun = before[1]
  const newRun = after[1]
  assert.equal(oldRun?.kind === 'events' && oldRun.events.length, 2)
  assert.equal(newRun?.kind === 'events' && newRun.events.length, 3)
  assert.notEqual(oldRun, newRun)
  assert.equal(before[2], after[2])
  const filtered = build([first, one, speech], true, (item) => item.id === first.id)
  assert.deepEqual(
    filtered.map((row) => row.key),
    ['speech'],
  )
  assert.equal(filtered[0]?.kind === 'message' && filtered[0].grouped, false)
})

test('status mode changes follow the channel activity setting; channel modes stay visible', () => {
  const join = (id: string, minute: number) =>
    message(id, minute, { kind: 'event', event: { type: 'join', actorId: 'a' } })
  const mode = (id: string, minute: number, text: string) =>
    message(id, minute, { kind: 'event', event: { type: 'mode', actorId: 'a', text } })
  const speech = message('speech', 0)
  const after = message('after', 5)
  const items = [speech, join('j', 1), mode('op', 2, '+o sage'), mode('flag', 3, '+m'), after]
  const hidden = createTimelineRows()(items, true)
  assert.deepEqual(
    hidden.map((row) => row.key),
    ['speech', 'flag', 'after'],
  )
  const folded = createTimelineRows()(
    [speech, join('j', 1), mode('op', 2, '+o sage'), after],
    false,
  )
  assert.equal(folded[1]?.kind === 'events' && folded[1].events.length, 2)
  const lone = createTimelineRows()([speech, mode('op', 2, '+v noah'), after], false)
  assert.equal(lone[1]?.kind === 'events' && lone[1].events.length, 1)
  // A network's own PREFIX letters decide what counts as status.
  assert.equal(createTimelineRows()([mode('y', 1, '+Y sage')], true, undefined, 'Yohv').length, 0)
  assert.equal(createTimelineRows()([mode('y', 1, '+Y sage')], true, undefined, 'ohv').length, 1)
})
