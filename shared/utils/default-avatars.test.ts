import assert from 'node:assert/strict'
import test from 'node:test'
import { bundledDefaultAvatar } from './default-avatars'

test('a default avatar on any instance maps to the bundled copy', () => {
  assert.equal(
    bundledDefaultAvatar('https://chat.example/avatars/defaults/avatar-003.png'),
    '/avatars/defaults/avatar-003.png',
  )
  assert.equal(
    bundledDefaultAvatar('https://other.example:8443/avatars/defaults/fox.webp?v=2'),
    '/avatars/defaults/fox.webp',
  )
  assert.equal(
    bundledDefaultAvatar('/avatars/defaults/avatar-003.png'),
    '/avatars/defaults/avatar-003.png',
  )
})

test('anything else is not a default avatar', () => {
  assert.equal(bundledDefaultAvatar(undefined), undefined)
  assert.equal(bundledDefaultAvatar(''), undefined)
  assert.equal(bundledDefaultAvatar('https://chat.example/files/a/b/avatar'), undefined)
  assert.equal(bundledDefaultAvatar('https://chat.example/avatars/defaults/'), undefined)
  assert.equal(
    bundledDefaultAvatar('https://chat.example/avatars/defaults/manifest.json'),
    undefined,
  )
  assert.equal(bundledDefaultAvatar('https://chat.example/avatars/defaults/../x.png'), undefined)
  assert.equal(bundledDefaultAvatar('https://chat.example/avatars/defaults/a/b.png'), undefined)
  assert.equal(bundledDefaultAvatar('https://u:p@chat.example/avatars/defaults/a.png'), undefined)
  assert.equal(bundledDefaultAvatar('javascript:/avatars/defaults/a.png'), undefined)
  assert.equal(bundledDefaultAvatar('data:image/png;base64,AAAA'), undefined)
})
