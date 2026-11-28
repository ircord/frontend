import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick, ref } from 'vue'
import { createMessageUpload, type UploadProvider } from './message-upload'

const open: UploadProvider = { available: true, maxBytes: 100, types: ['image/*'] }
const settle = async () => {
  await Promise.resolve()
  await nextTick()
}

test('asks for a network that a saved workspace opened before the lookup started', async () => {
  // The chat store opens the first network from its saved snapshot before it sets this up.
  const networkId = ref('net')
  const asked: string[] = []
  const upload = createMessageUpload(networkId, async (id) => {
    asked.push(id)
    return open
  })
  await settle()
  assert.deepEqual(asked, ['net'])
  assert.deepEqual(upload.limits.value, { maxBytes: 100, types: ['image/*'] })
})

test('asks again when another network opens, and ignores a late answer for the old one', async () => {
  const networkId = ref('')
  const answers = new Map<string, (provider: UploadProvider) => void>()
  const upload = createMessageUpload(
    networkId,
    (id) => new Promise((resolve) => answers.set(id, resolve)),
  )
  networkId.value = 'a'
  await nextTick()
  networkId.value = 'b'
  await nextTick()
  answers.get('b')!({ available: true, maxBytes: 2, types: null })
  await settle()
  answers.get('a')!(open)
  await settle()
  assert.deepEqual(upload.limits.value, { maxBytes: 2, types: [] })
})

test('a host that is down or a failed lookup leaves uploads off until asked again', async () => {
  const networkId = ref('net')
  let answer: () => Promise<UploadProvider> = async () => {
    throw new Error('offline')
  }
  const upload = createMessageUpload(networkId, () => answer())
  await settle()
  assert.equal(upload.limits.value, undefined)

  answer = async () => ({ available: false, maxBytes: 0, types: [] })
  await upload.refresh()
  assert.equal(upload.limits.value, undefined)

  answer = async () => open
  await upload.refresh()
  assert.deepEqual(upload.limits.value, { maxBytes: 100, types: ['image/*'] })
})

test('does not ask while lookups are switched off, as in the demo', async () => {
  const asked: string[] = []
  createMessageUpload(
    ref('net'),
    async (id) => {
      asked.push(id)
      return open
    },
    () => false,
  )
  await settle()
  assert.deepEqual(asked, [])
})
