import assert from 'node:assert/strict'
import test from 'node:test'
import { commitEvents, groupLock, groupView, isGroupAdmin, staleDevices } from './group'
import { groupChannel, groupIdFromServer, groupIdToServer, groupOfChannel } from './types'

const id = '00112233445566778899aabbccddeeff'
const settings = (admins: string[] = [], title = 'Weekend plans') => ({
  title,
  creator: { account: 'peter' },
  admins: admins.map((account) => ({ account })),
})
const devices = (account: string, ...ids: string[]) =>
  ids.map((deviceId) => ({ account, deviceId }))

test('a group view lists each account once with its devices', () => {
  const view = groupView(id, settings(['alex']), [
    ...devices('Peter', 'p1', 'p2'),
    ...devices('alex', 'a1'),
  ])
  assert.deepEqual(view, {
    groupId: id,
    title: 'Weekend plans',
    creator: 'peter',
    admins: ['alex'],
    members: [
      { account: 'alex', devices: ['a1'] },
      { account: 'Peter', devices: ['p1', 'p2'] },
    ],
  })
})

test('the creator and appointed admins may change members, others may not', () => {
  const view = groupView(id, settings(['alex']), [])
  assert.equal(isGroupAdmin(view, 'PETER'), true)
  assert.equal(isGroupAdmin(view, 'alex'), true)
  assert.equal(isGroupAdmin(view, 'sam'), false)
  assert.equal(isGroupAdmin(undefined, 'peter'), false)
})

const committer = { account: 'peter', deviceId: 'p1' }
const before = groupView(id, settings(), [...devices('peter', 'p1'), ...devices('alex', 'a1')])

test('a commit that adds and removes people makes one line each', () => {
  const after = groupView(id, settings(), [...devices('peter', 'p1'), ...devices('sam', 's1')])
  const lines = commitEvents(before, after, { committer, epoch: 4, removedSelf: false }, 10)
  assert.deepEqual(
    lines.map((l) => [l.kind, l.by, l.subject]),
    [
      ['added', 'peter', 'sam'],
      ['removed', 'peter', 'alex'],
    ],
  )
  assert.equal(new Set(lines.map((l) => l.id)).size, 2)
})

test('someone who said they left is not shown as removed again', () => {
  const after = groupView(id, settings(), devices('peter', 'p1'))
  const lines = commitEvents(
    before,
    after,
    { committer, epoch: 4, removedSelf: false },
    10,
    new Set(['alex']),
  )
  assert.deepEqual(lines, [])
})

test("a member's new or signed-out device is that member's line", () => {
  const after = groupView(id, settings(), [...devices('peter', 'p1'), ...devices('alex', 'a2')])
  const lines = commitEvents(before, after, { committer, epoch: 5, removedSelf: false }, 10)
  assert.deepEqual(
    lines.map((l) => [l.kind, l.by]),
    [
      ['device-added', 'alex'],
      ['device-removed', 'alex'],
    ],
  )
})

test('admin changes and a new title make their own lines', () => {
  const promoted = groupView(id, settings(['alex'], 'Trip'), [
    ...devices('peter', 'p1'),
    ...devices('alex', 'a1'),
  ])
  const lines = commitEvents(before, promoted, { committer, epoch: 6, removedSelf: false }, 10)
  assert.deepEqual(
    lines.map((l) => [l.kind, l.subject]),
    [
      ['admin', 'alex'],
      ['title', 'Trip'],
    ],
  )
  const demoted = commitEvents(promoted, before, { committer, epoch: 7, removedSelf: false }, 11)
  assert.deepEqual(
    demoted.map((l) => [l.kind, l.subject]),
    [
      ['not-admin', 'alex'],
      ['title', 'Weekend plans'],
    ],
  )
})

test('being removed is one line', () => {
  const lines = commitEvents(before, before, { committer, epoch: 8, removedSelf: true }, 10)
  assert.deepEqual(
    lines.map((l) => l.kind),
    ['removed-you'],
  )
})

test('the lock counts the other people you verified', () => {
  const view = groupView(id, settings(), [
    ...devices('peter', 'p1'),
    ...devices('alex', 'a1'),
    ...devices('sam', 's1'),
  ])
  const facts = { view, self: 'peter', pins: {}, changed: [], trouble: false }
  assert.deepEqual(groupLock(facts), { state: 'on', verified: 0, total: 2 })
  assert.deepEqual(groupLock({ ...facts, pins: { alex: { verified: true } } }), {
    state: 'on',
    verified: 1,
    total: 2,
  })
  assert.equal(
    groupLock({ ...facts, pins: { alex: { verified: true }, sam: { verified: true } } }).state,
    'verified',
  )
  assert.equal(groupLock({ ...facts, changed: ['SAM'] }).state, 'attention')
  assert.equal(groupLock({ ...facts, trouble: true }).state, 'attention')
  assert.equal(groupLock({ ...facts, view: undefined }).state, 'attention')
})

test('devices a newer signed list no longer names are stale', () => {
  const view = groupView(id, settings(), [
    ...devices('alex', 'a1', 'a2'),
    ...devices('peter', 'p1'),
  ])
  assert.deepEqual(staleDevices(view, 'Alex', ['A1']), [{ account: 'alex', deviceId: 'a2' }])
  assert.deepEqual(staleDevices(view, 'alex', ['a1', 'a2']), [])
  assert.deepEqual(staleDevices(view, 'sam', []), [])
})

test('group IDs convert between the core (hex) and the server (base64url)', () => {
  const server = groupIdToServer(id)
  assert.equal(server, 'ABEiM0RVZneImaq7zN3u_w')
  assert.equal(groupIdFromServer(server), id)
})

test("a group's channel is #e2ee- and its ID, with or without the #", () => {
  assert.equal(groupChannel(id), `#e2ee-${id}`)
  assert.equal(groupOfChannel(`#e2ee-${id}`), id)
  assert.equal(groupOfChannel(`e2ee-${id.toUpperCase()}`), id)
  assert.equal(groupOfChannel('#e2ee-1234'), '')
  assert.equal(groupOfChannel('#ircord'), '')
})
