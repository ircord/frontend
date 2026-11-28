/** Why encryption with a person cannot start, as a key under `encryption.blocked`. */
export type StartBlocker =
  | 'notDirect'
  | 'network'
  | 'selfAccount'
  | 'peerAccount'
  | 'peerNoKeys'
  | 'peerNoKeysAcross'
  | 'peerNoAnswer'
  | 'deviceNotReady'
  | 'bot'

/** What decides whether encryption with a person can start, as far as this client knows. */
export interface StartFacts {
  /** The network the person is on. */
  networkId: string
  /** The server's own network, where encryption works; absent when it is off or failed. */
  homeNetworkId?: string
  /** Your services account on the home network, or '' when you are not logged in. */
  selfAccount: string
  bot: boolean
  /**
   * The person's services account. '' when they are not logged in; undefined when the client
   * has not found out yet, which does not block (the encryption dialog looks it up).
   */
  peer: string | undefined
  /** Whether this device finished setting up encryption. */
  ready: boolean
  /** Whether the person published keys; undefined when not checked in this session. */
  peerHasKeys?: boolean
  /** The person's IRCord server did not answer when asked for their keys over IRC. */
  peerUnreachable?: boolean
  /**
   * This server asks other IRCord servers for keys (phase 2): a person without keys may also
   * use a server that cannot answer yet.
   */
  acrossServers?: boolean
}

/** The first thing that stops encryption from starting, or undefined when it can start. */
export function startBlockerFor(facts: StartFacts): StartBlocker | undefined {
  if (!facts.homeNetworkId || facts.networkId !== facts.homeNetworkId) return 'network'
  if (!facts.selfAccount) return 'selfAccount'
  if (facts.bot) return 'bot'
  if (facts.peer === '') return 'peerAccount'
  if (!facts.ready) return 'deviceNotReady'
  if (facts.peerUnreachable) return 'peerNoAnswer'
  if (facts.peerHasKeys !== false) return undefined
  return facts.acrossServers ? 'peerNoKeysAcross' : 'peerNoKeys'
}
