import assert from 'node:assert/strict'
import test from 'node:test'
import { voiceRoomsInSidebar } from './voice-sidebar'

test('The server-wide voice list keeps the active room visible when collapsed', () => {
  const rooms = ['lobby', 'active'].map((id) => ({
    id,
    name: id,
    available: true,
    capacity: 8,
    bitrateKbps: 48,
    participants: [],
  }))
  assert.deepEqual(voiceRoomsInSidebar(rooms, false), rooms)
  assert.deepEqual(voiceRoomsInSidebar(rooms, true, 'active'), [rooms[1]])
  assert.deepEqual(voiceRoomsInSidebar(rooms, true), [])
})
