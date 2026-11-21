import type { Message } from '../../shared/types/chat'
import { isChatter } from '../../shared/utils/events'

export type TimelineMessageRow =
  | { kind: 'message'; message: Message; key: string; dayBreak: boolean; grouped: boolean }
  | { kind: 'events'; events: Message[]; key: string; dayBreak: boolean }

export function firstMessageOf(row: TimelineMessageRow | undefined) {
  return row?.kind === 'message' ? row.message : row?.events[0]
}

/** Build the timeline once per history revision and retain the objects for unchanged rows. */
export function createTimelineRows() {
  const times = new WeakMap<Message, { source: string; time: number; day: string }>()
  let previous: TimelineMessageRow[] = []
  let byKey = new Map<string, TimelineMessageRow>()
  function timing(message: Message) {
    const source = message.createdAt
    const cached = times.get(message)
    if (cached?.source === source) return cached
    const date = new Date(source)
    const result = { source, time: date.getTime(), day: date.toDateString() }
    times.set(message, result)
    return result
  }

  return (
    messages: readonly Message[],
    hideEvents: boolean,
    ignored?: (message: Message) => boolean,
  ) => {
    const next: TimelineMessageRow[] = []
    for (const message of messages) {
      if (ignored?.(message)) continue
      const chatter = isChatter(message)
      if (chatter && hideEvents) continue
      const last = next.at(-1)
      const before = firstMessageOf(last)
      const current = timing(message)
      const prior = before && timing(before)
      const dayBreak = current.day !== prior?.day
      if (message.kind === 'event') {
        // Chatter runs span at most 50 events or five minutes, with no gap over a minute.
        if (
          chatter &&
          last?.kind === 'events' &&
          before &&
          isChatter(before) &&
          !dayBreak &&
          last.events.length < 50 &&
          current.time - prior!.time <= 5 * 60_000 &&
          current.time - timing(last.events.at(-1)!).time <= 60_000
        )
          last.events.push(message)
        else next.push({ kind: 'events', key: message.id, events: [message], dayBreak })
      } else {
        const key = message.clientId ?? message.id
        const grouped =
          last?.kind === 'message' &&
          !message.replyTo &&
          !dayBreak &&
          message.kind === last.message.kind &&
          message.senderId === last.message.senderId &&
          current.time - prior!.time < 5 * 60_000
        const cached = byKey.get(key)
        next.push(
          cached?.kind === 'message' &&
            cached.message === message &&
            cached.dayBreak === dayBreak &&
            cached.grouped === grouped
            ? cached
            : { kind: 'message', key, message, dayBreak, grouped },
        )
      }
    }

    // Runs are mutable during the scan. Reuse a previous run only after we know all its events.
    let changed = previous.length !== next.length
    for (let i = 0; i < next.length; i++) {
      const row = next[i]!
      if (row.kind === 'events') {
        const cached = byKey.get(row.key)
        if (
          cached?.kind === 'events' &&
          cached.dayBreak === row.dayBreak &&
          cached.events.length === row.events.length &&
          cached.events.every((event, j) => row.events[j] === event)
        )
          next[i] = cached
      }
      if (next[i] !== previous[i]) changed = true
    }
    if (changed) {
      previous = next
      byKey = new Map(next.map((row) => [row.key, row]))
    }
    return previous
  }
}
