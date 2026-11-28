import assert from 'node:assert/strict'
import test from 'node:test'
import { startBlockerFor, type StartFacts } from './start'

const ok: StartFacts = {
  networkId: 'home',
  homeNetworkId: 'home',
  selfAccount: 'alice',
  bot: false,
  peer: 'bob',
  ready: true,
  peerHasKeys: true,
}

test('encryption can start with a logged-in person on the home network', () => {
  assert.equal(startBlockerFor(ok), undefined)
})

test('another network, or encryption off on the server, blocks with the network reason', () => {
  assert.equal(startBlockerFor({ ...ok, networkId: 'libera' }), 'network')
  assert.equal(startBlockerFor({ ...ok, homeNetworkId: undefined }), 'network')
})

test('each missing condition gives its own reason, in order', () => {
  assert.equal(startBlockerFor({ ...ok, selfAccount: '' }), 'selfAccount')
  assert.equal(startBlockerFor({ ...ok, bot: true }), 'bot')
  assert.equal(startBlockerFor({ ...ok, peer: '' }), 'peerAccount')
  assert.equal(startBlockerFor({ ...ok, ready: false }), 'deviceNotReady')
  assert.equal(startBlockerFor({ ...ok, peerHasKeys: false }), 'peerNoKeys')
  assert.equal(startBlockerFor({ ...ok, selfAccount: '', bot: true, ready: false }), 'selfAccount')
})

test('facts the client has not checked yet do not block', () => {
  assert.equal(startBlockerFor({ ...ok, peer: undefined, peerHasKeys: undefined }), undefined)
})
