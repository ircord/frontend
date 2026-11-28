import { acceptHMRUpdate, defineStore } from 'pinia'
import type { Conversation, Message } from '../../shared/types/chat'
import type {
  Attachment,
  ConversationRecord,
  E2eeStatus,
  NoticeRecord,
  Payload,
  PlainRecord,
} from '../../shared/e2ee/types'
import {
  APPROVAL_MAILBOX,
  approvalCode,
  approvalDigest,
  approvalQr,
  encryptedToTag,
  fromBase64,
  messagePayload,
  newPayloadId,
  openHandover,
  sealHandover,
  tagToEncrypted,
  toBase64,
  toHex,
  type EncryptedField,
} from '../../shared/e2ee/codec'
import { presentMessage, type ConversationEffects, buildEffects } from '../../shared/e2ee/present'
import { E2eeClient, E2eeError, e2eeSupported } from '../utils/e2ee-client'
import { ApiError } from '../../shared/api/client'

/** The phase of this device's encryption setup. */
export type E2eePhase =
  /** The server does not offer encryption, or this browser lacks what it needs. */
  | 'off'
  | 'unsupported'
  | 'starting'
  /** Waiting for the home network to report this account's name. */
  | 'waiting'
  /** Another device of the account holds the identity: this one needs approval. */
  | 'needs-approval'
  /** The account started fresh from another device; this device's keys no longer count. */
  | 'reset-elsewhere'
  | 'ready'
  | 'failed'

/** Why a conversation cannot start encryption, as a catalog key, or undefined when it can. */
export type StartBlocker =
  'notDirect' | 'network' | 'selfAccount' | 'peerAccount' | 'peerNoKeys' | 'deviceNotReady' | 'bot'

export interface PendingApproval {
  id: number
  deviceId: string
  code: string
  digest: string
  request: Uint8Array
  at: string
}

type Directory = Awaited<ReturnType<ReturnType<typeof apiClient>['e2eeOwnDirectory']>>

const KEY_PACKAGE_STOCK = 10
const KEY_PACKAGE_BATCH = 20
const SYNC_INTERVAL = 60_000

/** A readable browser and system name for the device list, such as "Firefox on Linux". */
function deviceLabel() {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser'
  const system = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  return `${browser}${system ? ` on ${system}` : ''} (web)`
}

/** The identity key inside a device certificate (wire.md 3.1): after the version and account. */
function certificateIdentity(certificate: Uint8Array) {
  const accountLength = certificate[1] ?? 0
  return certificate.subarray(2 + accountLength, 2 + accountLength + 32)
}

/** The device ID inside a certificate request (wire.md 3.2). */
function requestDevice(request: Uint8Array) {
  const accountLength = request[1] ?? 0
  return toHex(request.subarray(2 + accountLength, 2 + accountLength + 16))
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((value, i) => value === b[i])

const status404 = (error: unknown) => error instanceof ApiError && error.status === 404
const status409 = (error: unknown) => error instanceof ApiError && error.status === 409

/**
 * End-to-end encrypted direct messages (experimental, ircord/issues#19). The keys live in a worker
 * (app/workers/e2ee.worker.ts) that one tab per account runs; this store drives it: device setup
 * and approval, the group log, starting and turning off encryption, encrypting sends and
 * decrypting what arrives, and presenting decrypted messages to the timeline.
 */
export const useE2eeStore = defineStore('e2ee', () => {
  const chat = useChatStore()
  const auth = useAuthStore()
  const { $i18n } = useNuxtApp()
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? $i18n.t(key, values) : $i18n.t(key)

  const phase = ref<E2eePhase>('off')
  const failure = ref('')
  const info = shallowRef<E2eeStatus>({ device: false })
  const directory = shallowRef<Directory>()
  const conversations = reactive<Record<string, ConversationRecord>>({})
  const notices = ref<NoticeRecord[]>([])
  /** Pinned identities this device knows: verified marks drive the lock's check. */
  const pins = reactive<Record<string, { verified: boolean }>>({})
  /** Decrypted (or self-sent) messages by ciphertext payload. */
  const plain = shallowReactive(new Map<string, PlainRecord>())
  /** Every stored record of conversations opened in this session, for edits and reactions. */
  const stored = shallowReactive(new Map<string, PlainRecord[]>())
  /** Ciphertexts this device could not read, with the reason shown in their place. */
  const failures = shallowReactive(new Map<string, string>())
  /** The conversation whose encryption panel is open. */
  const panel = ref('')
  /** Increases when messages this device could not read are worth trying again. */
  const retries = ref(0)
  let client: E2eeClient | undefined
  let syncTimer: ReturnType<typeof setInterval> | undefined
  let booted = false

  const capability = computed(() => chat.data?.capabilities.encryption)
  const enabled = computed(() => !!capability.value)
  /** The network where encryption works: the server's home network, when it passes the self-test. */
  const homeNetwork = computed(() => chat.data?.networks.find((n) => n.features.encryption))
  const account = computed(() => {
    const value = homeNetwork.value?.account
    return value && value !== '*' ? value : ''
  })
  const ready = computed(() => phase.value === 'ready')
  const call = <T>(method: string, ...args: unknown[]) => {
    if (!client)
      return Promise.reject(new E2eeError({ code: 'stopped', message: 'Encryption is off' }))
    return client.call<T>(method, ...args)
  }
  /** Multi-step operations run one at a time across tabs. */
  const flow = <T>(fn: () => Promise<T>) =>
    navigator.locks.request(`ircord-e2ee-flow:${auth.account?.id}`, fn) as Promise<T>

  // ---- Setup -----------------------------------------------------------------------------------

  async function boot() {
    if (booted || !enabled.value || !auth.account) return
    booted = true
    if (!e2eeSupported()) {
      phase.value = 'unsupported'
      return
    }
    phase.value = 'starting'
    try {
      client = new E2eeClient(auth.account.id)
      client.onChange((what) => void reload(what))
      info.value = await call<E2eeStatus>('open', auth.account.id)
      // The backend's limit for one payload, plus the "1.m." prefix the core counts.
      await client
        .configure('setTagBudget', Math.min(3840, (capability.value?.maxPayload ?? 3800) + 4))
        .catch(() => {})
      await reload('all')
      // Ask the browser not to clear this site's storage under pressure: it holds the keys.
      void navigator.storage?.persist?.().catch(() => false)
      await settle()
      syncTimer = setInterval(() => {
        if (!document.hidden && phase.value === 'ready') void sync()
      }, SYNC_INTERVAL)
    } catch (error) {
      phase.value = 'failed'
      failure.value = error instanceof Error ? error.message : String(error)
    }
  }

  async function reload(what: string) {
    if (what === 'all' || what === 'conversations') {
      const list = await call<ConversationRecord[]>('conversations')
      for (const id of Object.keys(conversations)) delete conversations[id]
      for (const record of list) conversations[record.conversationId] = record
      // Another tab may have started fresh: conversations it forgot follow the server again.
      if (what === 'all' && booted && phase.value !== 'starting') {
        serverChecked.clear()
        if (chat.activeId) void open(chat.activeId)
      }
    }
    if (what === 'all' || what === 'notices') notices.value = await call<NoticeRecord[]>('notices')
    if (what === 'all' || what === 'device') {
      info.value = await call<E2eeStatus>('status')
      if (what === 'device') await settle()
    }
  }

  /** Works out the phase from this device's keys and the account's key directory. */
  async function settle() {
    if (!account.value) {
      phase.value = 'waiting'
      return
    }
    const own = await apiClient().e2eeOwnDirectory()
    directory.value = own
    const status = info.value
    if (!status.device) {
      if (!own.identity) {
        await flow(async () => {
          // Another tab may have set up the account while this one waited for the lock.
          const again = await apiClient().e2eeOwnDirectory()
          if (again.identity) return
          info.value = await call<E2eeStatus>('createAccount', account.value)
          await apiClient().e2eePublishIdentity(toBase64(info.value.identityKey!))
          await registerDevice()
        })
        client?.announce('device')
        return settle()
      }
      phase.value = 'needs-approval'
      return
    }
    if (!status.certified) {
      phase.value = 'needs-approval'
      return
    }
    const identity = own.identity && fromBase64(own.identity.identityKey)
    if (!identity || !status.identityKey || !sameBytes(identity, status.identityKey)) {
      phase.value = 'reset-elsewhere'
      return
    }
    if (!own.devices.some((d) => d.deviceId === status.deviceId)) {
      // Published under this identity but missing: the first publish failed, or another
      // device removed this one. Only the identity holder can bring itself back.
      if (status.holdsIdentity) await registerDevice()
      else {
        phase.value = 'reset-elsewhere'
        return
      }
    }
    // What this device could not read before it was ready is tried again.
    if (phase.value !== 'ready') {
      failures.clear()
      retries.value++
    }
    phase.value = 'ready'
    await refreshPins()
    void sync()
  }

  /** Publishes this device's certificate, its last-resort key package and a stock of others. */
  async function registerDevice() {
    const own = await apiClient().e2eeOwnDirectory()
    const certificate = await call<Uint8Array>('certificate')
    const lastResort = await call<Uint8Array>('lastResortKeyPackage')
    await apiClient().e2eePutDevice(info.value.deviceId!, {
      generation: own.identity?.generation ?? 1,
      certificate: toBase64(certificate),
      lastResort: toBase64(lastResort),
      label: deviceLabel(),
    })
    const packages = await call<Uint8Array[]>('keyPackages', KEY_PACKAGE_BATCH)
    await apiClient().e2eeAddKeyPackages(info.value.deviceId!, packages.map(toBase64))
    directory.value = await apiClient().e2eeOwnDirectory()
  }

  async function refreshPins() {
    const peers = new Set(Object.values(conversations).map((c) => c.peer))
    for (const peer of peers) {
      const pin = await call<{ verified: boolean } | undefined>('pin', peer).catch(() => undefined)
      if (pin) pins[peer] = { verified: pin.verified }
    }
  }

  // ---- The group log ---------------------------------------------------------------------------

  let syncing: Promise<void> | undefined
  /** Joins groups from waiting Welcomes and applies new commits, one sync at a time. */
  function sync() {
    if (phase.value !== 'ready') return Promise.resolve()
    syncing ??= flow(syncNow).finally(() => (syncing = undefined))
    return syncing
  }

  async function syncNow() {
    const deviceId = info.value.deviceId!
    const welcomes = await apiClient().e2eeWelcomes(deviceId)
    for (const welcome of welcomes.items) {
      try {
        const joined = await call<{ groupId: string; peer: string }>(
          'joinDm',
          fromBase64(welcome.welcome),
        )
        await bindJoined(joined.groupId, joined.peer)
      } catch (error) {
        if (error instanceof E2eeError && error.code === 'identity-changed') {
          await noteIdentityChange(error)
          continue // Kept until the person acknowledges the new keys.
        }
      }
      await apiClient()
        .e2eeDeleteWelcome(welcome.id)
        .catch(() => {})
    }
    const groups = await call<{ groupId: string; peer: string }[]>('groups')
    for (const group of groups) await catchUp(group.groupId)
    await removeSignedOutDevices(groups)
    await topUp()
  }

  /** Applies a group's commits from this device's epoch on. */
  async function catchUp(groupId: string) {
    for (;;) {
      const epoch = await call<number>('epoch', groupId).catch(() => -1)
      if (epoch < 0) return
      const page = await apiClient()
        .e2eeCommits(groupId, epoch)
        .catch(() => undefined)
      const commits = page?.items.filter((c) => c.epoch >= epoch) ?? []
      if (!commits.length) return
      for (const commit of commits) {
        try {
          const applied = await call<{ removedSelf: boolean }>(
            'processCommit',
            fromBase64(commit.commit),
          )
          if (applied.removedSelf) return
        } catch {
          return
        }
      }
      if (commits.length < 100) return
    }
  }

  /** Posts a commit this device made, and merges it, or drops it when another commit won. */
  async function commitChange(
    groupId: string,
    make: () => Promise<{
      epoch: number
      commit: Uint8Array
      welcome?: Uint8Array
      groupInfo?: Uint8Array
    }>,
    welcomeFor: { account: string; deviceId: string }[] = [],
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const change = await make()
      try {
        await apiClient().e2eePostCommit(groupId, {
          epoch: change.epoch,
          commit: toBase64(change.commit),
          ...(change.groupInfo && { groupInfo: toBase64(change.groupInfo) }),
          ...(change.welcome && {
            welcomes: welcomeFor.map((d) => ({ ...d, welcome: toBase64(change.welcome!) })),
          }),
        })
        await call('confirmCommit', groupId)
        return true
      } catch (error) {
        await call('discardCommit', groupId).catch(() => {})
        if (!status409(error)) throw error
        await catchUp(groupId)
      }
    }
    return false
  }

  /** Removes this account's devices that left the key directory from every group. */
  async function removeSignedOutDevices(groups: { groupId: string }[]) {
    const own = await apiClient().e2eeOwnDirectory()
    directory.value = own
    const listed = new Set(own.devices.map((d) => d.deviceId))
    for (const group of groups) {
      const members = await call<{ account: string; deviceId: string }[]>('members', group.groupId)
      const gone = members.filter(
        (m) =>
          m.account === account.value &&
          m.deviceId !== info.value.deviceId &&
          !listed.has(m.deviceId),
      )
      if (gone.length)
        await commitChange(group.groupId, () => call('removeDevices', group.groupId, gone)).catch(
          () => {},
        )
    }
  }

  async function topUp() {
    const self = directory.value?.devices.find((d) => d.deviceId === info.value.deviceId)
    if (!self || self.keyPackages >= KEY_PACKAGE_STOCK) return
    const packages = await call<Uint8Array[]>('keyPackages', KEY_PACKAGE_BATCH)
    await apiClient()
      .e2eeAddKeyPackages(info.value.deviceId!, packages.map(toBase64))
      .catch(() => {})
  }

  /** The direct conversation with `peer` on the home network, if this workspace has one. */
  function conversationWith(peer: string) {
    const home = homeNetwork.value?.id
    return chat.data?.conversations.find(
      (c) =>
        c.networkId === home &&
        c.kind === 'direct' &&
        !c.party &&
        peerOf(c).toLowerCase() === peer.toLowerCase(),
    )
  }

  async function saveConversation(record: ConversationRecord) {
    conversations[record.conversationId] = record
    await call('putConversation', toRaw(record))
    client?.announce('conversations')
  }

  /** A group this device joined: the conversation with that person is encrypted from now on. */
  async function bindJoined(groupId: string, peer: string, conversationId?: string) {
    const c = conversationId
      ? chat.data?.conversations.find((x) => x.id === conversationId)
      : conversationWith(peer)
    if (!c) return
    const current = conversations[c.id]
    if (current?.groupId === groupId && current.on) return
    await saveConversation({
      conversationId: c.id,
      groupId,
      peer,
      on: true,
      by: peer,
      at: Date.now(),
    })
    pins[peer] = {
      verified: (await call<{ verified: boolean } | undefined>('pin', peer))?.verified ?? false,
    }
    await apiClient()
      .e2eeBindConversation(c.id, {
        groupId,
        peer,
        ...(current && current.groupId !== groupId && { replaces: current.groupId }),
      })
      .catch(() => {})
  }

  async function noteIdentityChange(error: E2eeError) {
    if (!error.account || !error.presented) return
    const id = `identity:${error.account}`
    if (notices.value.some((n) => n.id === id && sameBytes(n.presented, error.presented!))) return
    const record: NoticeRecord = {
      id,
      kind: 'identity-changed',
      account: error.account,
      presented: error.presented,
      at: Date.now(),
    }
    await call('putNotice', record)
    notices.value = [...notices.value.filter((n) => n.id !== id), record]
    client?.announce('notices')
  }

  /** Checks a person's identity key in the directory against this device's pin. */
  const checkedPeers = new Map<string, number>()
  async function checkPeer(peer: string) {
    if (!ready.value || Date.now() - (checkedPeers.get(peer) ?? 0) < 60_000) return
    checkedPeers.set(peer, Date.now())
    try {
      const dir = await apiClient().e2eeAccount(peer)
      const trust = await call<string>('pinIdentity', peer, fromBase64(dir.identityKey))
      pins[peer] = { verified: trust === 'verified' }
    } catch (error) {
      if (error instanceof E2eeError && error.code === 'identity-changed')
        await noteIdentityChange(error)
    }
  }

  // ---- Conversations ---------------------------------------------------------------------------

  const isEncrypted = (conversationId: string) => !!conversations[conversationId]?.on
  /** Accounts found by WHOIS, by folded nick: a direct message alone does not tell. */
  const whoisAccounts = reactive<Record<string, string>>({})
  const peerOf = (c: Conversation) => {
    const value = chat.directPartner(c)?.account
    if (value && value !== '*') return value
    return whoisAccounts[c.name.toLowerCase()] ?? ''
  }
  /** Looks up the other person's services account when the network has not reported it. */
  async function resolvePeer(c: Conversation) {
    if (peerOf(c) || c.kind !== 'direct') return peerOf(c)
    const nick = chat.directPartner(c)?.nick ?? c.name
    try {
      const found = await apiClient().whois(c.networkId, nick)
      if (found.found && found.account) whoisAccounts[c.name.toLowerCase()] = found.account
    } catch {
      // Offline or unknown: the dialog says the person is not logged in.
    }
    return peerOf(c)
  }

  /** What stops `start`, checked without asking the server. */
  function startBlocker(c: Conversation | undefined): StartBlocker | undefined {
    if (!c || c.kind !== 'direct' || c.party) return 'notDirect'
    if (!homeNetwork.value || c.networkId !== homeNetwork.value.id) return 'network'
    if (!account.value) return 'selfAccount'
    const partner = chat.directPartner(c)
    if (partner?.role === 'bot') return 'bot'
    if (!peerOf(c)) return 'peerAccount'
    if (!ready.value) return 'deviceNotReady'
    return peerKeys[peerOf(c).toLowerCase()] === false ? 'peerNoKeys' : undefined
  }
  /** Whether people have published keys, as far as this session checked. */
  const peerKeys = reactive<Record<string, boolean>>({})
  async function checkPeerKeys(peer: string) {
    try {
      const dir = await apiClient().e2eeAccount(peer)
      peerKeys[peer.toLowerCase()] = dir.devices.some((d) => d.keyPackages > 0 || d.lastResort)
    } catch (error) {
      if (status404(error)) peerKeys[peer.toLowerCase()] = false
    }
    return peerKeys[peer.toLowerCase()]
  }

  /** Turns on encryption in a direct conversation. Throws an Error with a readable message. */
  async function start(c: Conversation) {
    await resolvePeer(c)
    const blocker = startBlocker(c)
    if (blocker)
      throw new Error(
        t(`encryption.blocked.${blocker}`, { name: chat.directPartner(c)?.nick ?? c.name }),
      )
    const peer = peerOf(c)
    if (!(await checkPeerKeys(peer)))
      throw new Error(
        t('encryption.blocked.peerNoKeys', { name: chat.directPartner(c)?.nick ?? c.name }),
      )
    await flow(async () => {
      const dir = await apiClient().e2eeAccount(peer)
      try {
        await call('pinIdentity', peer, fromBase64(dir.identityKey))
      } catch (error) {
        if (error instanceof E2eeError && error.code === 'identity-changed') {
          await noteIdentityChange(error)
          throw new Error(
            t('encryption.reset.acknowledgeFirst', { name: chat.directPartner(c)?.nick ?? peer }),
            { cause: error },
          )
        }
        throw error
      }
      const theirs = await apiClient().e2eeClaim(peer)
      const ours = await apiClient().e2eeClaim(account.value)
      const own = ours.items.filter((i) => i.deviceId !== info.value.deviceId)
      const started = await call<{ groupId: string; welcome: Uint8Array; groupInfo?: Uint8Array }>(
        'startDm',
        peer,
        [...theirs.items, ...own].map((i) => fromBase64(i.keyPackage)),
      )
      try {
        await apiClient().e2eeCreateGroup({
          groupId: started.groupId,
          members: [account.value, peer],
          epoch: await call<number>('epoch', started.groupId),
          ...(started.groupInfo && { groupInfo: toBase64(started.groupInfo) }),
          welcomes: [
            ...theirs.items.map((i) => ({ account: peer, deviceId: i.deviceId })),
            ...own.map((i) => ({ account: account.value, deviceId: i.deviceId })),
          ].map((d) => ({ ...d, welcome: toBase64(started.welcome) })),
        })
      } catch (error) {
        await call('forgetGroup', started.groupId).catch(() => {})
        throw error
      }
      // After a reset the server still names the old group: this one replaces it.
      const server = await apiClient()
        .e2eeConversation(c.id)
        .catch(() => undefined)
      await apiClient().e2eeBindConversation(c.id, {
        groupId: started.groupId,
        peer,
        ...(server?.groupId && server.groupId !== started.groupId && { replaces: server.groupId }),
      })
      await saveConversation({
        conversationId: c.id,
        groupId: started.groupId,
        peer,
        on: true,
        by: account.value,
        at: Date.now(),
      })
      pins[peer] = {
        verified: (await call<{ verified: boolean } | undefined>('pin', peer))?.verified ?? false,
      }
    })
    await sendPayload(c.id, { v: 1, id: newPayloadId(), t: 'control', op: 'encryption-on' })
  }

  /** Turns off encryption for both people, with a signed notice first. */
  async function turnOff(c: Conversation) {
    const record = conversations[c.id]
    if (!record?.on) return
    await sendPayload(c.id, { v: 1, id: newPayloadId(), t: 'control', op: 'encryption-off' })
    await apiClient().e2eeTurnOff(c.id, record.groupId)
    await saveConversation({ ...toRaw(record), on: false, by: account.value, at: Date.now() })
  }

  /** Why sending into an encrypted conversation is paused, if it is. */
  function sendPause(conversationId: string) {
    const record = conversations[conversationId]
    if (!record?.on) return undefined
    if (!ready.value)
      return phase.value === 'needs-approval' || phase.value === 'reset-elsewhere'
        ? t('encryption.composer.approveFirst')
        : t('encryption.composer.notReady')
    if (notices.value.some((n) => n.account === record.peer))
      return t('encryption.reset.acknowledgeFirst', { name: record.peer })
    return undefined
  }

  /** The current group of an encrypted conversation, replacing one that was forgotten. */
  async function activeGroup(conversationId: string) {
    const record = conversations[conversationId]!
    const groups = await call<{ groupId: string }[]>('groups')
    if (groups.some((g) => g.groupId === record.groupId)) return record.groupId
    // The other person started fresh and already made a replacement group this device joined.
    const server = await apiClient()
      .e2eeConversation(conversationId)
      .catch(() => undefined)
    if (server?.groupId && groups.some((g) => g.groupId === server.groupId)) {
      await saveConversation({ ...toRaw(record), groupId: server.groupId })
      return server.groupId
    }
    // The group was forgotten after the other person started fresh: start a new one.
    const c = chat.data?.conversations.find((x) => x.id === conversationId)
    if (!c) throw new Error(t('encryption.composer.notReady'))
    await start(c)
    return conversations[conversationId]!.groupId
  }

  /**
   * Encrypts one payload for a conversation and returns what to send: one `encrypted` object per
   * IRC line. The plaintext is kept on this device so its own copy shows at once.
   */
  async function encryptPayload(
    conversationId: string,
    payload: Payload,
  ): Promise<EncryptedField[]> {
    const pause = sendPause(conversationId)
    if (pause && payload.t !== 'control') throw new Error(pause)
    const groupId = await activeGroup(conversationId)
    const at = Date.now()
    const result = await call<{ tags: string[]; records: PlainRecord[] }>(
      'encrypt',
      groupId,
      JSON.stringify(payload),
      { conversationId, at },
    )
    result.tags.forEach((tag, i) => plain.set(tagToEncrypted(tag).payload, result.records[i]!))
    const list = stored.get(conversationId)
    if (list) stored.set(conversationId, [...list, ...result.records])
    return result.tags.map(tagToEncrypted)
  }

  /** Encrypts and sends a payload through the chat store's outbox. */
  async function sendPayload(conversationId: string, payload: Payload) {
    const fields = await encryptPayload(conversationId, payload)
    for (const encrypted of fields) chat.sendEncrypted(conversationId, encrypted)
  }

  /** Sends a chat message into an encrypted conversation. */
  async function sendMessage(
    conversationId: string,
    fields: {
      text: string
      kind?: 'message' | 'action'
      replyTo?: Message
      attachments?: Attachment[]
      gif?: { url: string; width?: number; height?: number; title?: string }
    },
  ) {
    await sendPayload(
      conversationId,
      messagePayload({
        text: fields.text,
        kind: fields.kind,
        reply: fields.replyTo?.e2ee?.innerId,
        attachments: fields.attachments,
        gif: fields.gif,
      }),
    )
  }

  async function react(message: Message, emoji: string, remove: boolean) {
    const target = message.e2ee?.innerId
    if (!target) return
    await sendPayload(message.conversationId, {
      v: 1,
      id: newPayloadId(),
      t: 'react',
      target,
      emoji,
      ...(remove && { remove }),
    })
  }

  async function edit(message: Message, text: string) {
    const target = message.e2ee?.innerId
    if (!target) return
    await sendPayload(message.conversationId, { v: 1, id: newPayloadId(), t: 'edit', target, text })
  }

  // ---- Receiving -------------------------------------------------------------------------------

  let ingesting: Promise<void> = Promise.resolve()
  const queued = new Set<string>()

  /** Decrypts encrypted messages that arrived, in order, one at a time. */
  function ingest(messages: readonly Message[]) {
    const fresh = messages.filter(
      (m) =>
        m.encrypted &&
        !plain.has(m.encrypted.payload) &&
        !failures.has(m.encrypted.payload) &&
        !queued.has(m.encrypted.payload),
    )
    if (!fresh.length || !client) return
    for (const m of fresh) queued.add(m.encrypted!.payload)
    ingesting = ingesting.then(() => receiveAll(fresh)).catch(() => {})
  }

  async function receiveAll(messages: Message[]) {
    let synced = false
    for (const message of messages) {
      const payload = message.encrypted!.payload
      try {
        let record: PlainRecord | undefined
        for (let attempt = 0; ; attempt++) {
          try {
            record = await receiveOne(message)
            break
          } catch (error) {
            // A message from a group or epoch this device has not reached yet.
            const retry =
              error instanceof E2eeError &&
              (error.code === 'unknown-group' || error.code === 'mls') &&
              attempt === 0 &&
              !synced &&
              ready.value
            if (!retry) throw error
            synced = true
            await sync()
          }
        }
        if (record) await accept(record, message)
        else failures.set(payload, t('encryption.message.ownLost'))
      } catch (error) {
        if (error instanceof E2eeError && error.code === 'identity-changed')
          await noteIdentityChange(error)
        // A group this device has not joined, while the other person's new keys wait for
        // acknowledgment: the message is in their replacement group.
        const peer = conversations[message.conversationId]?.peer
        const waiting =
          error instanceof E2eeError &&
          error.code === 'unknown-group' &&
          !!peer &&
          notices.value.some((n) => n.account === peer)
        failures.set(
          payload,
          waiting ? t('encryption.message.identityChanged') : failureText(error),
        )
      } finally {
        queued.delete(payload)
      }
    }
  }

  function receiveOne(message: Message) {
    return call<PlainRecord | undefined>(
      'receive',
      encryptedToTag(message.encrypted!),
      message.senderAccount || message.account || '',
      {
        conversationId: message.conversationId,
        at: Date.parse(message.createdAt) || Date.now(),
        messageId: message.id,
      },
    )
  }

  function failureText(error: unknown) {
    if (!(error instanceof E2eeError)) return t('encryption.message.unreadable')
    switch (error.code) {
      case 'no-device':
      case 'stopped':
        return t('encryption.message.notApproved')
      case 'unknown-group':
      case 'mls':
        return t('encryption.message.beforeDevice')
      case 'sender-mismatch':
        return t('encryption.message.senderMismatch')
      case 'identity-changed':
        return t('encryption.message.identityChanged')
      default:
        return t('encryption.message.unreadable')
    }
  }

  /** A decrypted record: show it, and follow encryption turning on or off. */
  async function accept(record: PlainRecord, message: Message) {
    plain.set(message.encrypted!.payload, record)
    const list = stored.get(message.conversationId)
    if (list && !list.some((r) => r.key === record.key))
      stored.set(message.conversationId, [...list, record])
    const payload = record.payload
    if (!payload || record.own) return
    const current = conversations[message.conversationId]
    // A message from a group this device is in, in a conversation it has no record of yet: the
    // group came with a Welcome, so the conversation is encrypted (control events decide below).
    if (payload.t !== 'control') {
      if (!current) await turnedOn(message.conversationId, record)
      return
    }
    // Only a newer event changes the state, so replaying history cannot undo a later choice.
    if (current?.at && current.at > record.at) return
    if (payload.op === 'encryption-on') await turnedOn(message.conversationId, record)
    else if (current)
      await saveConversation({ ...toRaw(current), on: false, by: record.account, at: record.at })
  }

  /** Records a conversation as encrypted in the record's group, here and on the server. */
  async function turnedOn(conversationId: string, record: PlainRecord) {
    const groups = await call<{ groupId: string; peer: string }[]>('groups')
    const peer = groups.find((g) => g.groupId === record.groupId)?.peer
    if (!peer) return
    const current = conversations[conversationId]
    await saveConversation({
      conversationId,
      groupId: record.groupId,
      peer,
      on: true,
      by: record.account,
      at: record.at,
    })
    pins[peer] = {
      verified: (await call<{ verified: boolean } | undefined>('pin', peer))?.verified ?? false,
    }
    await apiClient()
      .e2eeBindConversation(conversationId, {
        groupId: record.groupId,
        peer,
        ...(current?.groupId &&
          current.groupId !== record.groupId && { replaces: current.groupId }),
      })
      .catch(() => {})
  }

  /** Loads what this device stored for a conversation: edits and reactions apply to older messages. */
  const serverChecked = new Set<string>()
  async function open(conversationId: string) {
    if (!client) return
    if (!stored.has(conversationId)) {
      const records = await call<PlainRecord[]>('conversationPlain', conversationId).catch(() => [])
      stored.set(conversationId, records)
    }
    // A device without its own record (new, or after starting fresh) takes the server's word
    // that a conversation is encrypted, so it never offers to send plaintext into it.
    if (
      !serverChecked.has(conversationId) &&
      !conversations[conversationId] &&
      chat.data?.conversations.some((c) => c.id === conversationId && c.kind === 'direct')
    ) {
      serverChecked.add(conversationId)
      const server = await apiClient()
        .e2eeConversation(conversationId)
        .catch(() => undefined)
      if (server?.encrypted && server.groupId && server.peer && !conversations[conversationId])
        await saveConversation({
          conversationId,
          groupId: server.groupId,
          peer: server.peer,
          on: true,
          at: Date.now(),
        })
    }
    const peer = conversations[conversationId]?.peer
    if (peer) void checkPeer(peer)
  }

  /** The server deleted a message: its plaintext leaves this device too. */
  function forget(message: Message) {
    if (!message.encrypted || !client) return
    plain.delete(message.encrypted.payload)
    void call('forgetMessage', message.id).catch(() => {})
  }

  const effects = computed(() => {
    const byConversation = new Map<string, ConversationEffects>()
    const all = new Map<string, PlainRecord[]>()
    for (const [id, list] of stored) all.set(id, [...list])
    for (const record of plain.values()) {
      const list = all.get(record.conversationId) ?? []
      if (!list.some((r) => r.key === record.key)) list.push(record)
      all.set(record.conversationId, list)
    }
    for (const [id, list] of all) byConversation.set(id, buildEffects(list))
    return byConversation
  })

  /**
   * The message as the timeline shows it: decrypted text and files, edits and reactions applied,
   * or a placeholder with the reason. Returns null for events that only change other messages.
   */
  function present(message: Message): Message | null {
    const conversation = conversations[message.conversationId]
    if (!message.encrypted && !conversation) return message
    const partner = (() => {
      const c = chat.conversationSettings(message.conversationId)
      return c ? chat.directPartner(c)?.id : undefined
    })()
    return presentMessage(message, {
      record: message.encrypted ? plain.get(message.encrypted.payload) : undefined,
      failure: message.encrypted ? failures.get(message.encrypted.payload) : undefined,
      effects: effects.value.get(message.conversationId),
      conversation,
      selfAccount: account.value,
      partnerId: partner,
      nickOf: (id) => chat.member(id)?.nick ?? '',
    })
  }

  /** Decrypts what it can of `messages` and returns them as the timeline shows them. */
  async function resolve(messages: Message[]) {
    if (!messages.some((m) => m.encrypted)) return messages
    const conversationIds = new Set(messages.map((m) => m.conversationId))
    for (const id of conversationIds) await open(id)
    ingest(messages)
    await ingesting
    return messages.flatMap((m) => present(m) ?? [])
  }

  /** Local search over decrypted messages, newest first. */
  async function search(text: string, conversationId?: string, limit = 50) {
    if (!client || !ready.value) return []
    return call<PlainRecord[]>('search', text, limit, conversationId).catch(() => [])
  }

  // ---- Verification and resets -----------------------------------------------------------------

  async function securityCode(peer: string) {
    return call<{ digits: string; qr: string }>('securityCode', peer)
  }

  async function setVerified(peer: string, verified: boolean) {
    await call('setVerified', peer, verified)
    pins[peer] = { verified }
    client?.announce('device')
  }

  /** Accepts a person's new identity after they started fresh. */
  async function acceptReset(notice: NoticeRecord) {
    await flow(async () => {
      await call('acceptIdentityChange', notice.account, notice.presented)
      await call('deleteNotice', notice.id)
    })
    notices.value = notices.value.filter((n) => n.id !== notice.id)
    pins[notice.account] = { verified: false }
    checkedPeers.delete(notice.account)
    client?.announce('notices')
    // The replacement group's Welcome waited for this: join it, then read what it carried.
    await sync()
    failures.clear()
    retries.value++
  }

  // ---- Device approval -------------------------------------------------------------------------

  /** On a device that needs approval: the QR code, the short code, and a wait for the certificate. */
  async function requestApproval(onApproved: () => void) {
    if (!info.value.device) info.value = await call<E2eeStatus>('createDevice', account.value)
    const own = await apiClient().e2eeOwnDirectory()
    if (!own.identity) throw new Error(t('encryption.approval.noIdentity'))
    const identityKey = fromBase64(own.identity.identityKey)
    const request = await call<Uint8Array>('certificateRequest')
    const digest = await approvalDigest(request, identityKey)
    const secret = crypto.getRandomValues(new Uint8Array(16))
    const deviceId = info.value.deviceId!
    const post = () =>
      apiClient()
        .e2eeRelay({ fromDevice: deviceId, toDevice: APPROVAL_MAILBOX, payload: toBase64(request) })
        .catch(() => undefined)
    await post()
    let stopped = false
    const repost = setInterval(() => void post(), 8 * 60_000)
    const poll = setInterval(async () => {
      if (stopped) return
      const messages = await apiClient()
        .e2eeApprovals(deviceId)
        .catch(() => undefined)
      for (const item of messages?.items ?? []) {
        try {
          const body = JSON.parse(new TextDecoder().decode(fromBase64(item.payload))) as {
            certificate: string
            handover?: string
          }
          const certificate = fromBase64(body.certificate)
          // Only a certificate from the identity key the codes were made with.
          if (!sameBytes(certificateIdentity(certificate), identityKey)) continue
          stopped = true
          info.value = await call<E2eeStatus>('installCertificate', certificate)
          await registerDevice()
          if (body.handover)
            await applyHandover(await openHandover(secret, fromBase64(body.handover)))
          await apiClient()
            .e2eeDeleteApproval(item.id)
            .catch(() => {})
          clearInterval(poll)
          clearInterval(repost)
          client?.announce('device')
          await settle()
          onApproved()
          return
        } catch {
          // A message that is not a valid answer is ignored; the next poll tries again.
        }
      }
    }, 2000)
    return {
      qr: approvalQr(deviceId, digest, secret),
      code: approvalCode(digest),
      cancel: () => {
        stopped = true
        clearInterval(poll)
        clearInterval(repost)
      },
    }
  }

  async function applyHandover(value: unknown) {
    const handover = value as {
      verified?: { account: string; identityKey: string }[]
      conversations?: ConversationRecord[]
    }
    for (const v of handover.verified ?? []) {
      try {
        await call('pinIdentity', v.account, fromBase64(v.identityKey))
        await call('setVerified', v.account, true)
      } catch {
        // A pin that does not match stays as this device found it.
      }
    }
    for (const record of handover.conversations ?? [])
      if (typeof record?.conversationId === 'string' && /^[0-9a-f]{32}$/.test(record.groupId))
        await saveConversation({ ...record })
  }

  /** On an approved device: the requests waiting in the account's approval mailbox. */
  async function pendingApprovals(): Promise<PendingApproval[]> {
    const identityKey = info.value.identityKey
    if (!identityKey) return []
    const messages = await apiClient().e2eeApprovals(APPROVAL_MAILBOX)
    const out: PendingApproval[] = []
    for (const item of messages.items) {
      const request = fromBase64(item.payload)
      const digest = await approvalDigest(request, identityKey)
      out.push({
        id: item.id,
        deviceId: requestDevice(request),
        code: approvalCode(digest),
        digest: toHex(digest),
        request,
        at: item.createdAt,
      })
    }
    return out
  }

  /**
   * Approves a new device: certifies it, relays the certificate (with this device's encrypted chat
   * list and verification marks when the QR secret is known), then adds it to every group.
   */
  async function approve(request: PendingApproval, secret?: Uint8Array) {
    const certificate = await call<Uint8Array>('certifyDevice', request.request)
    let handover: Uint8Array | undefined
    if (secret) {
      const verified: { account: string; identityKey: string }[] = []
      for (const peer of new Set(Object.values(conversations).map((c) => c.peer))) {
        const pin = await call<{ identityKey: Uint8Array; verified: boolean } | undefined>(
          'pin',
          peer,
        )
        if (pin?.verified) verified.push({ account: peer, identityKey: toBase64(pin.identityKey) })
      }
      handover = await sealHandover(secret, {
        verified,
        conversations: Object.values(conversations).map((c) => toRaw(c)),
      })
    }
    const body = new TextEncoder().encode(
      JSON.stringify({
        certificate: toBase64(certificate),
        ...(handover && { handover: toBase64(handover) }),
      }),
    )
    await apiClient().e2eeRelay({
      fromDevice: info.value.deviceId!,
      toDevice: request.deviceId,
      payload: toBase64(body),
    })
    await apiClient()
      .e2eeDeleteApproval(request.id)
      .catch(() => {})
    // The new device publishes its key packages once it installed the certificate.
    for (let i = 0; i < 90; i++) {
      const own = await apiClient().e2eeOwnDirectory()
      directory.value = own
      if (own.devices.some((d) => d.deviceId === request.deviceId && d.keyPackages > 0)) break
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    await addOwnDevice(request.deviceId)
  }

  /** Adds one of this account's devices to every group this device is in. */
  async function addOwnDevice(deviceId: string) {
    await flow(async () => {
      const groups = await call<{ groupId: string }[]>('groups')
      for (const group of groups) {
        const members = await call<{ account: string; deviceId: string }[]>(
          'members',
          group.groupId,
        )
        if (members.some((m) => m.deviceId === deviceId && m.account === account.value)) continue
        // Each group needs its own single-use key package.
        const claim = await apiClient().e2eeClaim(account.value)
        const item = claim.items.find((i) => i.deviceId === deviceId)
        if (!item) continue
        await commitChange(
          group.groupId,
          () => call('addDevices', group.groupId, [fromBase64(item.keyPackage)]),
          [{ account: account.value, deviceId }],
        ).catch(() => {})
      }
    })
  }

  /** Removes another device of this account from encryption. */
  async function removeDevice(deviceId: string) {
    await apiClient().e2eeDeleteDevice(deviceId)
    await flow(async () => removeSignedOutDevices(await call<{ groupId: string }[]>('groups')))
  }

  /**
   * Starts fresh: a new identity for the account. Other devices lose their approval, peers see a
   * warning, and earlier encrypted messages stay readable only where they were already read.
   */
  async function startFresh() {
    await flow(async () => {
      for (const id of Object.keys(conversations)) delete conversations[id]
      info.value = await call<E2eeStatus>('dropDevice')
      info.value = await call<E2eeStatus>('createAccount', account.value)
      await apiClient().e2eePublishIdentity(toBase64(info.value.identityKey!), true)
      await registerDevice()
    })
    serverChecked.clear()
    client?.announce('all')
    await settle()
    if (chat.activeId) await open(chat.activeId)
  }

  /** Signing out: removes this device from the directory and deletes its keys and history. */
  async function signOut() {
    if (!client || !auth.account) return
    if (info.value.deviceId && info.value.certified)
      await apiClient()
        .e2eeDeleteDevice(info.value.deviceId)
        .catch(() => {})
    await call('wipe', auth.account.id).catch(() => {})
    client.stop()
    client = undefined
  }

  /** Signing out of the only device that can read encrypted chats loses them for good. */
  const lastDevice = computed(
    () =>
      ready.value &&
      Object.keys(conversations).length > 0 &&
      (directory.value?.devices.length ?? 0) <= 1,
  )

  watch(
    () => [enabled.value, account.value, auth.account?.id] as const,
    ([on, name]) => {
      if (on && !booted) void boot()
      else if (on && name && phase.value === 'waiting') void settle().catch(() => {})
    },
    { immediate: true },
  )
  watch(
    () => chat.activeId,
    (id) => {
      if (id && (conversations[id] || chat.active?.kind === 'direct')) void open(id)
    },
    { immediate: true },
  )
  onScopeDispose(() => {
    clearInterval(syncTimer)
    client?.stop()
  })

  return {
    phase,
    failure,
    info,
    directory,
    conversations,
    notices,
    pins,
    panel,
    retries,
    enabled,
    ready,
    account,
    homeNetwork,
    lastDevice,
    peerKeys,
    isEncrypted: computed(() => isEncrypted),
    present: computed(() => present),
    startBlocker: computed(() => startBlocker),
    sendPause: computed(() => sendPause),
    checkPeerKeys,
    resolvePeer,
    peerOf: computed(() => peerOf),
    start,
    turnOff,
    sendMessage,
    react,
    edit,
    ingest,
    resolve,
    forget,
    search,
    securityCode,
    setVerified,
    acceptReset,
    requestApproval,
    pendingApprovals,
    approve,
    removeDevice,
    startFresh,
    signOut,
    sync,
    settle,
  }
})

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useE2eeStore, import.meta.hot))
