import assert from 'node:assert/strict'
import test from 'node:test'
import { instanceImageUrl, pictureSrc } from './instance-image'

const origins = ['https://chat.example', 'https://api.chat.example']

test('pictures on this instance load', () => {
  assert.equal(
    instanceImageUrl('/avatars/defaults/fox.webp', origins),
    '/avatars/defaults/fox.webp',
  )
  assert.equal(
    instanceImageUrl('https://chat.example/avatars/defaults/fox.webp', origins),
    'https://chat.example/avatars/defaults/fox.webp',
  )
  const upload = `https://api.chat.example/files/${'a'.repeat(32)}/${'b'.repeat(48)}/me.png`
  assert.equal(instanceImageUrl(upload, origins), upload)
  // An image picked on this device, before it is saved.
  assert.equal(
    instanceImageUrl('data:image/png;base64,AAAA', origins),
    'data:image/png;base64,AAAA',
  )
  assert.equal(
    instanceImageUrl('blob:https://chat.example/1', origins),
    'blob:https://chat.example/1',
  )
})

test('pictures on any other host do not load', () => {
  assert.equal(instanceImageUrl('https://tracker.example/me.png', origins), undefined)
  assert.equal(instanceImageUrl('https://chat.example.tracker.example/me.png', origins), undefined)
  assert.equal(instanceImageUrl('//tracker.example/me.png', origins), undefined)
  // Another IRCord instance's upload is still another host.
  const remote = `https://other.example/files/${'a'.repeat(32)}/${'b'.repeat(48)}/me.png`
  assert.equal(instanceImageUrl(remote, origins), undefined)
  // Same host on another port or scheme is another origin.
  assert.equal(instanceImageUrl('https://chat.example:8443/me.png', origins), undefined)
  assert.equal(instanceImageUrl('http://chat.example/me.png', origins), undefined)
})

test('unusable values do not load', () => {
  assert.equal(instanceImageUrl(undefined, origins), undefined)
  assert.equal(instanceImageUrl('', origins), undefined)
  assert.equal(instanceImageUrl('https://user:pass@chat.example/me.png', origins), undefined)
  assert.equal(instanceImageUrl('javascript:alert(1)', origins), undefined)
  assert.equal(instanceImageUrl('data:text/html,hi', origins), undefined)
  assert.equal(instanceImageUrl('/me.png', []), undefined)
  assert.equal(instanceImageUrl('/me.png', ['not a url']), undefined)
})

const cached = `/media/remote/${'c'.repeat(32)}`
const remoteUpload = `https://other.example/files/${'a'.repeat(32)}/${'b'.repeat(48)}/avatar`
const web = { origins, server: 'https://chat.example' }

test('the backend copy is preferred over the network address', () => {
  assert.equal(pictureSrc(cached, remoteUpload, web), cached)
  assert.equal(pictureSrc(cached, undefined, web), cached)
})

test('the network address is the fallback, and only when this instance serves it', () => {
  const own = `https://chat.example/files/${'a'.repeat(32)}/${'b'.repeat(48)}/avatar`
  assert.equal(pictureSrc(undefined, own, web), own)
  assert.equal(pictureSrc('', own, web), own)
  assert.equal(pictureSrc(undefined, remoteUpload, web), undefined)
  assert.equal(pictureSrc('https://tracker.example/me.png', remoteUpload, web), undefined)
})

test('a default avatar from any instance uses the bundled copy, not the cached one', () => {
  assert.equal(
    pictureSrc(cached, 'https://other.example/avatars/defaults/avatar-003.png', web),
    '/avatars/defaults/avatar-003.png',
  )
  assert.equal(
    pictureSrc(undefined, 'https://other.example/avatars/defaults/avatar-003.png', web),
    '/avatars/defaults/avatar-003.png',
  )
})

test('in the desktop app relative addresses resolve against the instance', () => {
  const desktop = {
    origins: ['https://chat.example', 'tauri://localhost'],
    server: 'https://chat.example',
    desktop: true,
  }
  assert.equal(pictureSrc(cached, remoteUpload, desktop), `https://chat.example${cached}`)
  assert.equal(
    pictureSrc(cached, 'https://other.example/avatars/defaults/avatar-003.png', desktop),
    '/avatars/defaults/avatar-003.png',
  )
  // With the page first, as before, relative addresses would resolve to tauri: and be dropped.
  assert.equal(
    pictureSrc(cached, remoteUpload, { ...desktop, origins: ['tauri://localhost'] }),
    undefined,
  )
})
