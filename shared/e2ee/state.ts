import type { ConversationRecord } from './types'

/**
 * How a direct conversation's encryption follows what a device reads. Every device replays the
 * conversation's history when it loads it, and a device that was offline reads events long after
 * they happened, so the rules must hold up when events are read again or late.
 *
 * Each "turn on" makes a new group, so one group is turned on once and off at most once. An "off"
 * from the conversation's current group is final: a group that was turned off never comes back.
 * Between different groups, the newer "on" wins by time. Times come from the server, except a
 * device's own changes and joins, which use its clock.
 */

/** A decrypted event from another device, as far as encryption is concerned. */
export interface EncryptionEvent {
  groupId: string
  /** The control operation, or undefined for an ordinary message. */
  op?: 'encryption-on' | 'encryption-off'
  /** When the server received it, in milliseconds. */
  at: number
}

/**
 * What an event does to the conversation's record: `on` when it turns encryption on in the
 * event's group, `off` when it turns it off, or undefined when it changes nothing.
 */
export function eventChange(
  current: ConversationRecord | undefined,
  event: EncryptionEvent,
): 'on' | 'off' | undefined {
  // The current group's "off" wins however late it is read, even after this device joined it.
  if (event.op === 'encryption-off')
    return current?.on && current.groupId === event.groupId ? 'off' : undefined
  // A message from a group this device is in, in a conversation it has no record of yet: the
  // group came with a Welcome, so the conversation is encrypted.
  if (!event.op) return current ? undefined : 'on'
  // The current group is on already, or was turned off and stays off.
  if (current?.groupId === event.groupId) return undefined
  // An older group's "on" read again after a newer choice changes nothing.
  if (current?.at && current.at > event.at) return undefined
  return 'on'
}

/**
 * Whether joining a group from a Welcome turns encryption on in the conversation. A group this
 * device already knows keeps its state, so a late Welcome cannot undo an "off".
 */
export function joinTurnsOn(current: ConversationRecord | undefined, groupId: string) {
  return current?.groupId !== groupId
}
