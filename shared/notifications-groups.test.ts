import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultNotificationSettings,
  levelFor,
  notificationFor,
  notifiesLikeDirect,
} from './notifications'

const group = { id: 'c1', kind: 'channel' as const, name: 'e2ee-00112233445566778899aabbccddeeff' }
const channel = { id: 'c2', kind: 'channel' as const, name: 'ircord' }
const message = {
  text: '[encrypted message - open IRCord to read]',
  kind: 'message' as const,
  senderId: 'm1',
}

test('an encrypted group notifies like a direct message: its text is ciphertext', () => {
  assert.equal(notifiesLikeDirect(group), true)
  assert.equal(notifiesLikeDirect({ ...group, name: `#${group.name}` }), true)
  assert.equal(notifiesLikeDirect(channel), false)
  assert.equal(notifiesLikeDirect({ ...group, name: 'e2ee-123' }), false)
  const settings = { ...defaultNotificationSettings, channelDefault: 'mentions' as const }
  assert.equal(levelFor(settings, group), settings.directDefault)
  assert.equal(notificationFor(settings, group, message, 'you', 'alex'), 'mention')
  assert.equal(notificationFor(settings, channel, message, 'you', 'alex'), null)
})

test('a muted encrypted group stays silent', () => {
  const settings = { ...defaultNotificationSettings, levels: { c1: 'none' as const } }
  assert.equal(levelFor(settings, group), 'none')
  assert.equal(notificationFor(settings, group, message, 'you', 'alex'), null)
})
