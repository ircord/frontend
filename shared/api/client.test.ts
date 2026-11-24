import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, createIRCordClient } from './client'

const response = new Response(null, { status: 409, statusText: 'Conflict' })

test('ApiError exposes recognized problem types and retains status and detail', () => {
  const error = new ApiError(response, {
    type: 'urn:ircord:problem:delivery-uncertain',
    detail: 'Delivery needs reconciliation.',
    title: 'Conflict',
  })

  assert.equal(error.status, 409)
  assert.equal(error.statusCode, 409)
  assert.equal(error.code, 'delivery-uncertain')
  assert.equal(error.problemType, 'urn:ircord:problem:delivery-uncertain')
  assert.equal(error.data.detail, 'Delivery needs reconciliation.')
  assert.equal(error.message, 'Delivery needs reconciliation.')
})

test('ApiError keeps unknown and missing problem types generic', () => {
  const unknown = new ApiError(response, {
    type: 'urn:attacker:invented-code',
    detail: 'Safe detail from the response.',
  })
  const missing = new ApiError(response, { title: 'Conflict' })

  assert.equal(unknown.code, undefined)
  assert.equal(unknown.problemType, undefined)
  assert.equal(unknown.message, 'Safe detail from the response.')
  assert.equal(missing.code, undefined)
  assert.equal(missing.problemType, undefined)
  assert.equal(missing.message, 'Conflict')
})

test('ApiError does not recognize inherited lookup keys as problem types', () => {
  for (const type of ['constructor', 'toString', '__proto__']) {
    const error = new ApiError(response, { type, detail: 'Generic conflict.' })

    assert.equal(error.code, undefined, `${type} must not be a recognized code`)
    assert.equal(error.problemType, undefined, `${type} must not be exposed as a stable type`)
    assert.equal(error.message, 'Generic conflict.')
  }
})

test('a conflicting theme save exposes the stored copy to the editor', async () => {
  const theirs = { id: 'theme', name: 'Their theme', updatedAt: '2026-11-21T12:00:00.000Z' }
  const client = createIRCordClient('https://example.invalid/api/v1', {
    fetch: async () => Response.json({ status: 412, data: { theirs } }, { status: 412 }),
  })
  await assert.rejects(
    client.saveAppTheme(theirs.id, { theme: { name: 'My theme' }, expected: null }),
    (error: unknown) => {
      assert(error instanceof ApiError)
      assert.equal(error.status, 412)
      assert.deepEqual(error.data.data, { theirs })
      return true
    },
  )
})

test('uploads send the message marker only when asked', async () => {
  const urls: string[] = []
  const client = createIRCordClient('https://example.invalid', {
    fetch: async (request) => {
      urls.push(new URL(request.url).search)
      return Response.json({ id: 'u', name: 'a.png', url: '/files/u/t/a.png' })
    },
  })
  const file = new File(['x'], 'a.png', { type: 'image/png' })
  await client.upload(file, 'net', undefined, undefined, 'message')
  await client.upload(file, 'net')
  assert.equal(urls[0], '?networkId=net&use=message')
  assert.equal(urls[1], '?networkId=net')
})
