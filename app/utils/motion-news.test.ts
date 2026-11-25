import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  arrivedAfter,
  badgeRose,
  glidesToArrivals,
  reactionCounts,
  risenReactions,
} from './motion-news'

const ids = (...list: string[]) => list.map((id) => ({ id }))
const context = {
  reduced: false,
  visible: true,
  following: true,
  interacting: false,
  catchingUp: false,
}

test('only unknown messages after a known one are arrivals', () => {
  const known = new Set(['a', 'b'])
  assert.deepEqual(arrivedAfter(known, ids('a', 'b', 'c')), [{ id: 'c' }])
  assert.deepEqual(arrivedAfter(known, ids('z', 'a', 'b')), [])
  assert.deepEqual(arrivedAfter(new Set(), ids('a', 'b')), [])
  assert.deepEqual(arrivedAfter(known, ids('x', 'y')), [])
})

test('one or two arrivals glide; a burst, no arrivals or any blocker snaps', () => {
  assert.equal(glidesToArrivals(1, context), true)
  assert.equal(glidesToArrivals(2, context), true)
  assert.equal(glidesToArrivals(3, context), false)
  assert.equal(glidesToArrivals(0, context), false)
  for (const blocker of ['reduced', 'interacting', 'catchingUp'] as const)
    assert.equal(glidesToArrivals(1, { ...context, [blocker]: true }), false, blocker)
  for (const blocker of ['visible', 'following'] as const)
    assert.equal(glidesToArrivals(1, { ...context, [blocker]: false }), false, blocker)
})

test('a reaction count that rises is news; a row that just appeared is not', () => {
  const before = reactionCounts([
    { emoji: '👍', memberIds: ['a'] },
    { emoji: '🎉', memberIds: ['a', 'b'] },
  ])
  assert.deepEqual(
    risenReactions(before, [
      { emoji: '👍', memberIds: ['a', 'b'] },
      { emoji: '🎉', memberIds: ['a', 'b'] },
      { emoji: '🔥', memberIds: ['c'] },
    ]),
    ['👍', '🔥'],
  )
  assert.deepEqual(risenReactions(before, [{ emoji: '🎉', memberIds: ['a'] }]), [])
  assert.deepEqual(risenReactions(undefined, [{ emoji: '👍', memberIds: ['a'] }]), [])
})

test('a mention badge plays only when it was there and its count rose', () => {
  assert.equal(badgeRose(1, 2), true)
  assert.equal(badgeRose(2, 2), false)
  assert.equal(badgeRose(3, 1), false)
  assert.equal(badgeRose(undefined, 4), false)
})
