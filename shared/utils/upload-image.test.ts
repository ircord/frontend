import assert from 'node:assert/strict'
import { test } from 'node:test'
import { uploadImageSources } from './upload-image'

const origin = 'https://chat.example'
const path = `/files/${'a'.repeat(32)}/${'b'.repeat(48)}/photo.webp`

test('only eligible uploads have responsive display variants', () => {
  const url = origin + path
  assert.deepEqual(uploadImageSources(url, 80, '48', origin), {
    src: `${url}?w=80&h=48`,
    srcset: `${url}?w=80&h=48 1x, ${url}?w=160&h=96 2x`,
  })
  assert.deepEqual(uploadImageSources(path, undefined, 4096, origin), { src: `${path}?h=2048` })
  for (const src of [undefined, `${url}?signature=a%2Bb`, `https://other.example${path}`]) {
    assert.deepEqual(uploadImageSources(src, 80, 48, origin), { src })
  }
})
