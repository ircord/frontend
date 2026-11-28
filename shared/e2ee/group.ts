/**
 * Encrypted groups in the web client (experimental, ircord/issues#19, phase 2): how this device
 * reads a group's members and settings from MLS, which timeline lines a commit makes, and what
 * the header's lock says. Everything here is pure, so it is unit tested without the core.
 */
import type { GroupEventRecord, GroupView } from './types'

export interface DeviceRef {
  account: string
  deviceId: string
}

/** `{ title, creator, admins }` as the core returns a group's settings. */
export interface CoreSettings {
  title: string
  creator: { account: string; identityKey?: Uint8Array }
  admins: { account: string; identityKey?: Uint8Array }[]
}

/** A commit the core applied (wasm `applied`). */
export interface AppliedCommit {
  groupId: string
  epoch: number
  committer: DeviceRef
  added: DeviceRef[]
  removed: DeviceRef[]
  removedSelf: boolean
  identityChanges: { account: string; presented: Uint8Array }[]
  settings?: CoreSettings
}

const fold = (account: string) => account.toLowerCase()
export const sameAccount = (a?: string, b?: string) => !!a && !!b && fold(a) === fold(b)

/** Builds the view of a group from the core's settings and member list. */
export function groupView(
  groupId: string,
  settings: CoreSettings,
  members: DeviceRef[],
): GroupView {
  const byAccount = new Map<string, { account: string; devices: string[] }>()
  for (const m of members) {
    const entry = byAccount.get(fold(m.account)) ?? { account: m.account, devices: [] }
    entry.devices.push(m.deviceId)
    byAccount.set(fold(m.account), entry)
  }
  return {
    groupId,
    title: settings.title,
    creator: settings.creator.account,
    admins: settings.admins.map((a) => a.account),
    members: [...byAccount.values()].sort((a, b) => a.account.localeCompare(b.account)),
  }
}

/** Whether `account` may add and remove people: the creator and the admins they appointed. */
export const isGroupAdmin = (view: GroupView | undefined, account: string) =>
  !!view && (sameAccount(view.creator, account) || view.admins.some((a) => sameAccount(a, account)))

/**
 * The timeline lines one applied commit makes, comparing the group before and after it. People
 * who announced that they left (`left`) are not also shown as removed.
 */
export function commitEvents(
  before: GroupView | undefined,
  after: GroupView,
  applied: Pick<AppliedCommit, 'committer' | 'epoch' | 'removedSelf'>,
  at: number,
  left: ReadonlySet<string> = new Set(),
): GroupEventRecord[] {
  const by = applied.committer.account
  const out: GroupEventRecord[] = []
  const push = (kind: GroupEventRecord['kind'], subject?: string) =>
    out.push({
      id: `${after.groupId}:${applied.epoch}:${out.length}`,
      groupId: after.groupId,
      at,
      kind,
      by,
      ...(subject !== undefined && { subject }),
    })
  if (applied.removedSelf) {
    push('removed-you')
    return out
  }
  const old = new Map((before?.members ?? []).map((m) => [fold(m.account), m]))
  const now = new Map(after.members.map((m) => [fold(m.account), m]))
  for (const [key, m] of now) {
    const was = old.get(key)
    if (!was) {
      push('added', m.account)
      continue
    }
    // The committer made the change; the member whose devices changed is its subject.
    if (m.devices.some((d) => !was.devices.includes(d))) push('device-added', m.account)
    if (was.devices.some((d) => !m.devices.includes(d))) push('device-removed', m.account)
  }
  for (const [key, m] of old) if (!now.has(key) && !left.has(key)) push('removed', m.account)
  if (before) {
    const admins = new Set(before.admins.map(fold))
    const nowAdmins = new Set(after.admins.map(fold))
    for (const a of after.admins) if (!admins.has(fold(a))) push('admin', a)
    for (const a of before.admins)
      if (!nowAdmins.has(fold(a)) && now.has(fold(a))) push('not-admin', a)
    if (before.title !== after.title) push('title', after.title)
  }
  return out
}

export interface GroupLockFacts {
  view?: GroupView
  self: string
  /** Pinned identities this device knows, by account. */
  pins: Readonly<Record<string, { verified: boolean } | undefined>>
  /** Accounts with an unacknowledged identity change. */
  changed: readonly string[]
  /** This device is not ready, fell out of the group, or saw plaintext. */
  trouble: boolean
}

/** The header lock of a group: how many of the other people this device verified. */
export function groupLock(facts: GroupLockFacts) {
  const people = (facts.view?.members ?? [])
    .map((m) => m.account)
    .filter((a) => !sameAccount(a, facts.self))
  const verified = people.filter(
    (a) => facts.pins[a]?.verified ?? facts.pins[fold(a)]?.verified,
  ).length
  const attention =
    facts.trouble || !facts.view || people.some((a) => facts.changed.some((c) => sameAccount(a, c)))
  return {
    state: attention
      ? ('attention' as const)
      : people.length > 0 && verified === people.length
        ? ('verified' as const)
        : ('on' as const),
    verified,
    total: people.length,
  }
}

/**
 * The devices to remove after an account's newest signed device list: those of the account still
 * in a group that the list no longer names. The account's own devices remove them first; any
 * admin does when they did not.
 */
export function staleDevices(
  view: GroupView,
  account: string,
  listed: readonly string[],
): DeviceRef[] {
  const member = view.members.find((m) => sameAccount(m.account, account))
  if (!member) return []
  const keep = new Set(listed.map((d) => d.toLowerCase()))
  return member.devices
    .filter((d) => !keep.has(d.toLowerCase()))
    .map((deviceId) => ({ account: member.account, deviceId }))
}
