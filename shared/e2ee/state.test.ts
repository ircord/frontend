import assert from 'node:assert/strict'
import test from 'node:test'
import { eventChange, joinTurnsOn, type EncryptionEvent } from './state'
import type { ConversationRecord } from './types'

const record = (groupId: string, on: boolean, at: number): ConversationRecord => ({
  conversationId: 'dm',
  groupId,
  peer: 'alice',
  on,
  by: 'alice',
  at,
})
const on = (groupId: string, at: number): EncryptionEvent => ({ groupId, op: 'encryption-on', at })
const off = (groupId: string, at: number): EncryptionEvent => ({
  groupId,
  op: 'encryption-off',
  at,
})
const message = (groupId: string, at: number): EncryptionEvent => ({ groupId, at })

/** Applies events in the order a device reads them, as the store does. */
function replay(start: ConversationRecord | undefined, events: EncryptionEvent[]) {
  let current = start
  for (const event of events) {
    const change = eventChange(current, event)
    if (change === 'on') current = record(event.groupId, true, event.at)
    else if (change === 'off') current = { ...current!, on: false, at: event.at }
  }
  return current
}

test('encryption follows on, off and on again in a new group', () => {
  const events = [on('g1', 100), message('g1', 110), off('g1', 120), on('g2', 130)]
  assert.deepEqual(replay(undefined, events), record('g2', true, 130))
})

test("a device that joined after the off still turns off: the current group's off is final", () => {
  // The device was offline: it joins g1 from its Welcome now, then reads the earlier history.
  const joined = record('g1', true, 5_000)
  assert.equal(replay(joined, [on('g1', 100), message('g1', 110), off('g1', 120)])?.on, false)
})

test('history read again after the off does not turn the group back on', () => {
  const turnedOff = record('g1', false, 120)
  assert.equal(eventChange(turnedOff, on('g1', 100)), undefined)
  assert.equal(eventChange(turnedOff, message('g1', 110)), undefined)
  // Even with a clock that put the off before the on.
  assert.equal(eventChange(record('g1', false, 50), on('g1', 100)), undefined)
})

test('an older group read again does not replace a newer one', () => {
  const current = record('g2', true, 130)
  assert.equal(eventChange(current, on('g1', 100)), undefined)
  assert.equal(eventChange(current, off('g1', 120)), undefined)
  assert.equal(eventChange(record('g2', false, 140), off('g1', 120)), undefined)
})

test('reading the whole history again ends where it ended', () => {
  const events = [on('g1', 100), off('g1', 120), on('g2', 130), off('g2', 140)]
  assert.equal(replay(undefined, events)?.on, false)
  assert.deepEqual(replay(record('g2', false, 140), events), record('g2', false, 140))
  assert.deepEqual(replay(record('g2', true, 130), events.slice(0, 3)), record('g2', true, 130))
})

test('a message from a group starts the record only when there is none', () => {
  assert.equal(eventChange(undefined, message('g1', 110)), 'on')
  assert.equal(eventChange(record('g0', false, 90), message('g1', 110)), undefined)
})

test('a Welcome for a group this device knows changes nothing', () => {
  assert.equal(joinTurnsOn(undefined, 'g1'), true)
  assert.equal(joinTurnsOn(record('g0', false, 90), 'g1'), true)
  assert.equal(joinTurnsOn(record('g1', true, 90), 'g1'), false)
  assert.equal(joinTurnsOn(record('g1', false, 120), 'g1'), false)
})
