/**
 * "Is this news?" decisions behind the small motion touches: a message that just arrived, a
 * reaction count that just rose. Pure, so the components only decide whether to play something.
 */

/** Ids after the first already-known one that are not known. Nothing is known while history
 * first loads or after switching, and older history arrives above the first known message:
 * neither is news. */
export function arrivedAfter<T extends { id: string }>(
  known: ReadonlySet<string>,
  list: readonly T[],
) {
  const first = list.findIndex((item) => known.has(item.id))
  return first < 0 ? [] : list.slice(first).filter((item) => !known.has(item.id))
}

/** A glide follows one or two rows into view; a burst of arrivals snaps, as a busy channel would
 * otherwise keep the ease running. */
export const GLIDE_ARRIVALS = 2

export interface ArrivalContext {
  /** Reduced motion, on or by the system. */
  reduced: boolean
  /** The window is on screen; catch-up after returning to it snaps. */
  visible: boolean
  /** The reader is at the newest message and follows the live end. */
  following: boolean
  /** A hand is on the list. */
  interacting: boolean
  /** Catching up after the app came back to the front. */
  catchingUp: boolean
}

/** Whether other people's new messages should glide the list to the end rather than snap. */
export function glidesToArrivals(count: number, context: ArrivalContext) {
  return (
    count > 0 &&
    count <= GLIDE_ARRIVALS &&
    !context.reduced &&
    context.visible &&
    context.following &&
    !context.interacting &&
    !context.catchingUp
  )
}

/** Emoji whose count went up since `before`. A reaction new to the message counts as a rise;
 * with no earlier counts (the row has just appeared) nothing is news. */
export function risenReactions(
  before: ReadonlyMap<string, number> | undefined,
  reactions: readonly { emoji: string; memberIds: readonly string[] }[],
) {
  if (!before) return []
  return reactions
    .filter((reaction) => reaction.memberIds.length > (before.get(reaction.emoji) ?? 0))
    .map((reaction) => reaction.emoji)
}

/** The counts `risenReactions` compares against next time. */
export function reactionCounts(
  reactions: readonly { emoji: string; memberIds: readonly string[] }[],
) {
  return new Map(reactions.map((reaction) => [reaction.emoji, reaction.memberIds.length]))
}

/** A mention badge's count went up. A badge that was not there before the change (the app just
 * loaded, or the conversation just appeared) does not play. */
export function badgeRose(before: number | undefined, now: number) {
  return before !== undefined && now > before
}
