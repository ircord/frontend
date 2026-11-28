import { sameAccount } from './group'

/** Someone the client already knows on the home network: a chat member it has seen. */
export interface KnownPerson {
  nick: string
  displayName?: string
  /** The services account: '' or '*' when the person is not logged in. */
  account: string
  role?: string
  avatarUrl?: string
  avatarSrc?: string
  color?: string
}

/** Someone the server's people search found on the network. */
export interface FoundPerson {
  key: string
  displayName: string
  servicesAccount?: string
  nickname?: string
  eligible: boolean
  avatarUrl?: string
  avatarSrc?: string
}

/** One suggestion for an encrypted group. `account` is '' when the person is not logged in. */
export interface GroupCandidate {
  key: string
  account: string
  name: string
  nick?: string
  bot: boolean
  /** Where the client knows the person from: a direct message, a shared channel or a search. */
  source: 'direct' | 'channel' | 'search'
  avatarUrl?: string
  avatarSrc?: string
  color?: string
}

const accountOf = (value: string | undefined) => (value && value !== '*' ? value : '')

/** 0 for a prefix match (or no query), 1 for a match inside, -1 for none. */
function matches(query: string, ...values: (string | undefined)[]) {
  if (!query) return 0
  const found = values.map((v) => v?.toLowerCase() ?? '')
  return found.some((v) => v.startsWith(query)) ? 0 : found.some((v) => v.includes(query)) ? 1 : -1
}

/**
 * The people to suggest for an encrypted group: people you have direct messages with first, then
 * people from shared channels, then the network search. One entry per account; people already
 * chosen and your own account are left out.
 */
export function groupCandidates(options: {
  query: string
  direct: readonly KnownPerson[]
  channel: readonly KnownPerson[]
  found: readonly FoundPerson[]
  exclude: readonly string[]
  limit?: number
}): GroupCandidate[] {
  const query = options.query.trim().toLowerCase()
  const seen = new Set<string>()
  const taken = (account: string) =>
    options.exclude.some((other) => sameAccount(other, account)) || seen.has(account.toLowerCase())
  const result: { candidate: GroupCandidate; order: number }[] = []
  const add = (candidate: GroupCandidate, order: number) => {
    if (candidate.account) {
      if (taken(candidate.account)) return
      seen.add(candidate.account.toLowerCase())
    } else if (seen.has(`nick:${candidate.nick?.toLowerCase()}`)) return
    else seen.add(`nick:${candidate.nick?.toLowerCase()}`)
    result.push({ candidate, order })
  }
  const known = (people: readonly KnownPerson[], source: 'direct' | 'channel', base: number) => {
    const ranked = people
      .map((person) => ({
        person,
        rank: matches(query, accountOf(person.account), person.nick, person.displayName),
      }))
      .filter((item) => item.rank >= 0)
    if (source === 'channel')
      ranked.sort((a, b) =>
        (a.person.displayName || a.person.nick).localeCompare(
          b.person.displayName || b.person.nick,
        ),
      )
    for (const { person, rank } of ranked) {
      const account = accountOf(person.account)
      add(
        {
          key: account ? `account:${account.toLowerCase()}` : `nick:${person.nick.toLowerCase()}`,
          account,
          name: person.displayName || person.nick,
          nick: person.nick,
          bot: person.role === 'bot',
          source,
          avatarUrl: person.avatarUrl,
          avatarSrc: person.avatarSrc,
          color: person.color,
        },
        base + rank,
      )
    }
  }
  known(options.direct, 'direct', 0)
  known(options.channel, 'channel', 2)
  for (const person of options.found) {
    const account = person.eligible ? accountOf(person.servicesAccount) : ''
    if (!account) continue
    add(
      {
        key: `account:${account.toLowerCase()}`,
        account,
        name: person.displayName || account,
        nick: person.nickname,
        bot: false,
        source: 'search',
        avatarUrl: person.avatarUrl,
        avatarSrc: person.avatarSrc,
      },
      4,
    )
  }
  // Without a query, people logged out of every account are noise: they cannot be added.
  return result
    .filter((item) => item.candidate.account || query)
    .sort((a, b) => a.order - b.order)
    .slice(0, options.limit ?? 8)
    .map((item) => item.candidate)
}

/** Account names typed into the field: spaces and commas separate them. */
export const typedAccounts = (text: string) => text.split(/[\s,]+/).filter(Boolean)
