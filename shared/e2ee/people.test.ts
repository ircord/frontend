import assert from 'node:assert/strict'
import test from 'node:test'
import { groupCandidates, typedAccounts, type FoundPerson, type KnownPerson } from './people'

const person = (nick: string, account = nick, extra: Partial<KnownPerson> = {}): KnownPerson => ({
  nick,
  account,
  displayName: nick,
  ...extra,
})
const found = (account: string, extra: Partial<FoundPerson> = {}): FoundPerson => ({
  key: `p:${account}`,
  displayName: account,
  servicesAccount: account,
  eligible: true,
  ...extra,
})
const base = { query: '', direct: [], channel: [], found: [], exclude: [] }

test('direct-message people come first, then shared channels, then the network search', () => {
  const list = groupCandidates({
    ...base,
    direct: [person('zed')],
    channel: [person('carol'), person('amy')],
    found: [found('bob')],
  })
  assert.deepEqual(
    list.map((c) => [c.account, c.source]),
    [
      ['zed', 'direct'],
      ['amy', 'channel'],
      ['carol', 'channel'],
      ['bob', 'search'],
    ],
  )
})

test('one entry per account, whatever the case, and chosen people and yourself stay out', () => {
  const list = groupCandidates({
    ...base,
    direct: [person('Bob', 'bob')],
    channel: [person('bobby', 'BOB'), person('me'), person('dan')],
    found: [found('Bob'), found('dan'), found('eve')],
    exclude: ['ME', 'eve'],
  })
  assert.deepEqual(
    list.map((c) => c.account),
    ['bob', 'dan'],
  )
})

test('the query matches account, nick or display name; prefixes rank above inner matches', () => {
  const list = groupCandidates({
    ...base,
    query: 'an',
    channel: [
      person('xanthe'),
      person('nick1', 'anna'),
      person('q', 'q', { displayName: 'Andrew' }),
      person('zoe'),
    ],
  })
  assert.deepEqual(
    list.map((c) => c.account),
    // Andrew and nick1 (account anna) both match at the start, by display name.
    ['q', 'anna', 'xanthe'],
  )
})

test('people who are not logged in show only when searched for, and bots are marked', () => {
  const people = [person('guest', '*'), person('helper', 'helper', { role: 'bot' })]
  assert.deepEqual(
    groupCandidates({ ...base, channel: people }).map((c) => c.key),
    ['account:helper'],
  )
  const searched = groupCandidates({ ...base, query: 'g', channel: people })
  assert.deepEqual(
    searched.map((c) => [c.key, c.account]),
    [['nick:guest', '']],
  )
  assert.equal(groupCandidates({ ...base, channel: people })[0]!.bot, true)
})

test('ineligible or account-less search results are left out, and the list is limited', () => {
  const list = groupCandidates({
    ...base,
    found: [
      found('a', { eligible: false }),
      found('b', { servicesAccount: undefined }),
      ...'cdefghijk'.split('').map((n) => found(n)),
    ],
  })
  assert.deepEqual(
    list.map((c) => c.account),
    ['c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
  )
})

test('typed account names split on spaces and commas', () => {
  assert.deepEqual(typedAccounts(' bob, carol  dan,'), ['bob', 'carol', 'dan'])
})
