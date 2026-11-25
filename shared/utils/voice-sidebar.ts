import type { components } from '../generated/api'

export function voiceRoomsInSidebar(
  rooms: readonly components['schemas']['Room'][],
  collapsed: boolean,
  activeID?: string,
) {
  return collapsed ? rooms.filter((room) => room.id === activeID) : rooms
}
