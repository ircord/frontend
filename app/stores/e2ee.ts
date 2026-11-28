import { acceptHMRUpdate, defineStore } from 'pinia'
import type { Conversation, Member, Message } from '../../shared/types/chat'
import { startBlockerFor, type StartBlocker } from '../../shared/e2ee/start'
import { eventChange, joinTurnsOn } from '../../shared/e2ee/state'
import {
  groupIdFromServer,
  groupIdToServer,
  groupOfChannel,
  type Attachment,
  type ConversationRecord,
  type E2eeStatus,
  type GroupEventRecord,
  type GroupView,
  type NoticeRecord,
  type Payload,
  type PlainRecord,
} from '../../shared/e2ee/types'
import {
  commitEvents,
  groupLock,
  groupView,
  isGroupAdmin,
  sameAccount,
  staleDevices,
  type AppliedCommit,
  type CoreSettings,
  type DeviceRef,
} from '../../shared/e2ee/group'
import {
  APPROVAL_MAILBOX,
  approvalQr,
  encryptedToTag,
  formatApprovalCode,
  fromBase64,
  messagePayload,
  newApprovalCode,
  newPayloadId,
  normalizeApprovalCode,
  openApprovalRequest,
  openHandover,
  parseApprovalQr,
  sealApprovalRequest,
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
  /** Encryption for this account is set up on another IRCord server, which alone can read it. */
  | 'elsewhere'
  | 'ready'
  | 'failed'

export type { StartBlocker }

type Directory = Awaited<ReturnType<ReturnType<typeof apiClient>['e2eeOwnDirectory']>>
type Chat = Awaited<ReturnType<ReturnType<typeof apiClient>['e2eeChats']>>['items'][number]
type ChatChange = { groupId?: string; account?: string; reason: string }
type Change = { epoch: number; commit: Uint8Array; welcome?: Uint8Array; groupInfo?: Uint8Array }
type CoreConversation =
  | { kind: 'dm'; groupId: string; peer: string }
  | { kind: 'group'; groupId: string; settings: CoreSettings }
type Candidates = {
  accepted?:
    | { index: number; own: true; epoch: number }
    | { index: number; own: false; applied: AppliedCommit }
  rejected: { index: number; code: string; message: string }[]
}
/** Who changes an encrypted chat's members: the people it adds, removes or promotes. */
type ChatChangeMeta = {
  added?: string[]
  removed?: string[]
  admins?: string[]
  members?: string[]
}

/** The largest encrypted group: 32 accounts (wire.md 7.4). */
export const GROUP_MAX_ACCOUNTS = 32

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
  /** Encrypted chats carried over IRC, as this account's server lists them, by group ID (hex). */
  const chats = reactive<Record<string, Chat>>({})
  /** Each encrypted group's members and settings, as MLS says, by group ID (hex). */
  const groups = reactive<Record<string, GroupView>>({})
  /** Timeline lines of encrypted groups, from the commits this device applied. */
  const groupEvents = shallowRef<GroupEventRecord[]>([])
  /** Groups this device lost step with: it asked to be let back in. */
  const fellOut = reactive<Record<string, 'asking' | 'failed'>>({})
  /** Accounts that said they left a group, by group ID: an admin's client removes them. */
  const leftGroup = reactive<Record<string, string[]>>({})
  /** The "New encrypted group" dialog is open. */
  const groupDialog = ref(false)
  let client: E2eeClient | undefined
  let syncTimer: ReturnType<typeof setInterval> | undefined
  let booted = false
  // Settles once boot has read this device's conversation records. History that is decrypted or
  // replayed before then would be judged against no record and could overwrite the stored one.
  let markLoaded = () => {}
  const loaded = new Promise<void>((resolve) => (markLoaded = resolve))

  const capability = computed(() => chat.data?.capabilities.encryption)
  const enabled = computed(() => !!capability.value)
  /** The server carries encrypted chats over IRC (phase 2): to other IRCord servers, and groups. */
  const acrossServers = computed(() => !!capability.value?.acrossServers)
  const groupsAvailable = computed(() => !!capability.value?.groups && acrossServers.value)
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
      markLoaded()
      // Ask the browser not to clear this site's storage under pressure: it holds the keys.
      void navigator.storage?.persist?.().catch(() => false)
      await settle()
      syncTimer = setInterval(() => {
        if (!document.hidden && phase.value === 'ready') void sync()
      }, SYNC_INTERVAL)
    } catch (error) {
      phase.value = 'failed'
      failure.value = error instanceof Error ? error.message : String(error)
    } finally {
      markLoaded()
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
    if (what === 'all' || what === 'events')
      groupEvents.value = await call<GroupEventRecord[]>('groupEvents').catch(() => [])
    if (what === 'groups' && ready.value) await refreshGroupViews()
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
      // One account, one identity: another IRCord server holds it, and this one refuses to set
      // up a second, which everyone would see as an identity change.
      if (!own.identity && own.elsewhere) {
        phase.value = 'elsewhere'
        return
      }
      if (!own.identity) {
        const elsewhere = await flow(async () => {
          // Another tab may have set up the account while this one waited for the lock.
          const again = await apiClient().e2eeOwnDirectory()
          if (again.identity) return false
          if (again.elsewhere) return true
          info.value = await call<E2eeStatus>('createAccount', account.value)
          try {
            await apiClient().e2eePublishIdentity(toBase64(info.value.identityKey!))
          } catch (error) {
            // The server found this account's keys on another IRCord server just now.
            if (!status409(error)) throw error
            info.value = await call<E2eeStatus>('dropDevice')
            return true
          }
          await registerDevice()
          return false
        })
        if (elsewhere) {
          phase.value = 'elsewhere'
          return
        }
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
    // The first device's identity publish failed: publish it again.
    if (!own.identity && status.holdsIdentity && status.identityKey) {
      await apiClient().e2eePublishIdentity(toBase64(status.identityKey))
      return settle()
    }
    const identity = own.identity && fromBase64(own.identity.identityKey)
    if (!identity || !status.identityKey || !sameBytes(identity, status.identityKey)) {
      phase.value = 'reset-elsewhere'
      return
    }
    if (!own.devices.some((d) => d.deviceId === status.deviceId)) {
      // Missing from the directory: a device whose publish never completed publishes itself
      // again. One that was published was removed by another device, and stays out.
      const certificate = await call<Uint8Array | undefined>('certificate')
      const ours = certificate && sameBytes(certificateIdentity(certificate), identity)
      if (ours && !wasRegistered()) await registerDevice()
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
    await refreshGroups()
    await refreshGroupViews()
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
    writeLocal(registeredKey(), info.value.deviceId!)
    directory.value = await apiClient().e2eeOwnDirectory()
    await publishDeviceList().catch(() => {})
  }

  /**
   * On the device that holds the identity key: signs the account's current devices and publishes
   * the list, so other people refuse a signed-out device that a server shows them again. The
   * counter only goes up; an unchanged list is not published again.
   */
  async function publishDeviceList() {
    if (!acrossServers.value || !info.value.holdsIdentity || !info.value.certified) return
    const own = await apiClient().e2eeOwnDirectory()
    const ids = own.devices.map((d) => d.deviceId).sort()
    if (own.deviceList) {
      const current = await call<{ devices: string[] }>(
        'checkDeviceList',
        fromBase64(own.deviceList.list),
      ).catch(() => undefined)
      if (current && [...current.devices].sort().join() === ids.join()) return
    }
    const list = await call<Uint8Array>('signDeviceList', ids)
    const signed = await call<{ counter: number }>('checkDeviceList', list)
    await apiClient().e2eePutDeviceList(
      toBase64(list),
      Math.max(signed.counter, (own.deviceList?.counter ?? 0) + 1),
    )
  }
  /** Whether this device's directory entry was published once (so a missing one was removed). */
  const registeredKey = () => `ircord.${auth.account?.id}.e2ee-registered`
  const wasRegistered = () =>
    readLocal(registeredKey(), (v) => (typeof v === 'string' ? v : '')) === info.value.deviceId

  async function refreshPins() {
    const peers = new Set(Object.values(conversations).flatMap((c) => (c.peer ? [c.peer] : [])))
    for (const view of Object.values(groups))
      for (const m of view.members) if (!sameAccount(m.account, account.value)) peers.add(m.account)
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
    if (acrossServers.value) {
      await joinChatWelcomes(deviceId)
      await refreshChats()
    }
    const dms = await refreshGroups()
    await refreshGroupViews()
    for (const dm of dms) await (chats[dm.groupId] ? catchUpChat(dm.groupId) : catchUp(dm.groupId))
    for (const id of Object.keys(groups)) if (chats[id]) await catchUpChat(id)
    await reconcileChats()
    await removeSignedOutDevices([...dms, ...Object.keys(groups).map((groupId) => ({ groupId }))])
    await tendGroups()
    await topUp()
    await publishDeviceList().catch(() => {})
  }

  // ---- Chats carried over IRC (phase 2) --------------------------------------------------------

  /** A group ID in the server's text form as the core names it, or '' when it is not one. */
  const serverGroup = (id: string | undefined) => {
    if (!id || !/^[A-Za-z0-9_-]{22}$/.test(id)) return ''
    return groupIdFromServer(id)
  }

  /** Reads the server's list of encrypted chats carried over IRC. */
  async function refreshChats() {
    if (!acrossServers.value) return
    const page = await apiClient()
      .e2eeChats()
      .catch(() => undefined)
    if (!page) return
    const next: Record<string, Chat> = {}
    for (const c of page.items) {
      const id = serverGroup(c.groupId)
      if (id) next[id] = c
    }
    for (const id of Object.keys(chats)) if (!next[id]) delete chats[id]
    Object.assign(chats, next)
  }

  /** Reads each group's members and settings from MLS. */
  async function refreshGroupViews() {
    const list = await call<CoreConversation[]>('coreConversations').catch(
      () => [] as CoreConversation[],
    )
    const seen = new Set<string>()
    for (const c of list) {
      if (c.kind !== 'group') continue
      seen.add(c.groupId)
      await refreshGroupView(c.groupId, c.settings)
    }
    for (const id of Object.keys(groups)) if (!seen.has(id)) delete groups[id]
    return list
  }
  async function refreshGroupView(groupId: string, settings?: CoreSettings) {
    try {
      const s = settings ?? (await call<CoreSettings>('groupSettings', groupId))
      groups[groupId] = groupView(groupId, s, await call<DeviceRef[]>('members', groupId))
    } catch {
      delete groups[groupId]
    }
    return groups[groupId]
  }

  async function recordEvents(records: GroupEventRecord[]) {
    if (!records.length) return
    await call('putGroupEvents', records)
    const ids = new Set(records.map((r) => r.id))
    groupEvents.value = [...groupEvents.value.filter((e) => !ids.has(e.id)), ...records]
    client?.announce('events')
  }

  /** Opens the Welcomes that arrived over IRC: invitations to groups, and direct chats. */
  async function joinChatWelcomes(deviceId: string) {
    const page = await apiClient()
      .e2eeChatWelcomes(deviceId)
      .catch(() => undefined)
    for (const w of page?.items ?? []) {
      const groupId = serverGroup(w.groupId)
      try {
        if (w.kind === 'group') {
          const joined = await call<{
            groupId: string
            inviter: DeviceRef
            identityChanges: { account: string; presented: Uint8Array }[]
            rejoined: boolean
          }>('joinGroup', fromBase64(w.welcome))
          for (const change of joined.identityChanges) await noteIdentityChange(change)
          delete fellOut[groupId]
          await recordEvents([
            {
              id: `${groupId}:welcome:${w.id}`,
              groupId,
              at: Date.parse(w.position.at) || Date.now(),
              kind: joined.rejoined ? 'joined' : 'added',
              by: joined.inviter.account,
              subject: account.value,
            },
          ])
        } else await call('joinDm', fromBase64(w.welcome))
      } catch (error) {
        if (error instanceof E2eeError && error.code === 'identity-changed') {
          await noteIdentityChange(error)
          continue // Kept until the person acknowledges the new keys.
        }
        // A Welcome this device cannot open: it is not among the devices added.
      }
      await apiClient()
        .e2eeDeleteChatWelcome(w.id)
        .catch(() => {})
    }
  }

  /**
   * Records the chats carried over IRC that this device is in as encrypted conversations, and
   * joins direct chats it was invited to: as in phase 1, a direct chat needs no accepting. A
   * group waits for Join or Decline.
   */
  async function reconcileChats() {
    for (const [groupId, c] of Object.entries(chats)) {
      if (c.kind === 'group') {
        const view = groups[groupId]
        if (!view || c.state !== 'joined' || !c.conversationId) continue
        const current = conversations[c.conversationId]
        if (current?.groupId === groupId && (current.title === view.title || !current.on)) continue
        await saveConversation({
          conversationId: c.conversationId,
          groupId,
          peer: '',
          on: current?.on ?? true,
          kind: 'group',
          transport: 'irc',
          title: view.title,
          by: current?.by ?? c.inviter,
          at: current?.at ?? (Date.parse(c.createdAt) || Date.now()),
        })
        continue
      }
      // A direct chat counts only if MLS says its group is a DM with the chat's person.
      if (!samePeer(groupPeers[groupId], c.peer)) continue
      const existing = c.conversationId ? conversations[c.conversationId] : undefined
      if (existing?.groupId === groupId) continue
      // Both people started a chat at once: the one the account sorting first started wins on
      // both sides, unless this one replaces the other after someone started fresh.
      if (
        existing?.on &&
        existing.groupId !== groupId &&
        serverGroup(c.replaces) !== existing.groupId &&
        groupPeers[existing.groupId] &&
        (!c.inviter || c.inviter.toLowerCase() > (existing.by ?? '').toLowerCase())
      )
        continue
      let joined = c
      if (c.state === 'invited') {
        const answer = await apiClient()
          .e2eeJoinChat(c.groupId)
          .catch(() => undefined)
        if (!answer) continue
        chats[groupId] = joined = answer
      }
      if (!joined.conversationId) continue
      const current = conversations[joined.conversationId]
      if (current?.groupId === groupId || !joinTurnsOn(current, groupId)) continue
      await saveConversation({
        conversationId: joined.conversationId,
        groupId,
        peer: joined.peer ?? c.peer ?? '',
        on: true,
        transport: 'irc',
        by: joined.inviter || joined.peer,
        at: Date.parse(joined.createdAt) || Date.now(),
      })
      const peer = joined.peer ?? ''
      if (peer)
        pins[peer] = {
          verified: (await call<{ verified: boolean } | undefined>('pin', peer))?.verified ?? false,
        }
    }
  }

  /**
   * Applies a chat's commits from this device's epoch on. For each epoch the server lists every
   * candidate in the order the IRC server stamped them; the core applies the first it accepts,
   * so every device ends in the same state. A device that accepts none lost step and asks to be
   * let back in.
   */
  async function catchUpChat(groupId: string) {
    const serverId = groupIdToServer(groupId)
    for (let round = 0; round < 200; round++) {
      const epoch = await call<number>('epoch', groupId).catch(() => -1)
      if (epoch < 0) return
      const page = await apiClient()
        .e2eeChatCommits(serverId, epoch)
        .catch(() => undefined)
      const candidates = page?.items.filter((c) => c.epoch === epoch) ?? []
      if (!candidates.length) return
      const before = groups[groupId]
      const result = await call<Candidates>(
        'applyCandidates',
        groupId,
        candidates.map((c) => fromBase64(c.commit)),
      ).catch(() => undefined)
      if (!result) return
      if (!result.accepted) {
        await fallOut(groupId)
        return
      }
      const at = Date.parse(candidates[result.accepted.index]?.position.at ?? '') || Date.now()
      if (result.accepted.own) {
        await refreshGroupView(groupId)
        continue
      }
      const applied = result.accepted.applied
      for (const change of applied.identityChanges) await noteIdentityChange(change)
      if (!before) continue // A direct chat: nothing to show.
      const after = await refreshGroupView(groupId)
      if (applied.removedSelf || !after) {
        await recordEvents(
          commitEvents(before, before, { ...applied, removedSelf: true }, at, new Set()),
        )
        await removedFrom(groupId)
        return
      }
      await recordEvents(
        commitEvents(before, after, applied, at, new Set(leftGroup[groupId] ?? [])),
      )
    }
  }

  /**
   * An admin removed this account (or this device) from a group: its keys are forgotten and the
   * conversation stays, saying so. What was read stays readable. The server already took away
   * the right to enter and kicked the account; leaving is the person's choice.
   */
  async function removedFrom(groupId: string) {
    await call('forgetGroup', groupId).catch(() => {})
    delete groups[groupId]
    delete fellOut[groupId]
    client?.announce('groups')
  }

  /** This device lost step with a group: asks the group to take it back in. */
  async function fallOut(groupId: string) {
    if (!groups[groupId] || fellOut[groupId]) return
    try {
      const request = await call<Uint8Array>('rejoinRequest', groupId)
      const certificate = await call<Uint8Array>('certificate')
      // The backend's rejoin object carries the certificate and, as its key package, the core's
      // signed request, which holds the fresh key package (wire.md 7.4.6).
      await apiClient().e2eeRequestRejoin(groupIdToServer(groupId), {
        deviceId: info.value.deviceId!,
        certificate: toBase64(certificate),
        keyPackage: toBase64(request),
      })
      fellOut[groupId] = 'asking'
    } catch {
      fellOut[groupId] = 'failed'
    }
  }

  /**
   * Posts a commit to a chat carried over IRC. The server answers after it settled: accepted when
   * it came first for its epoch. A commit that lost is dropped, the winner applied, and the change
   * made again on top of it.
   */
  async function commitChat(
    groupId: string,
    make: () => Promise<Change>,
    meta: ChatChangeMeta = {},
  ) {
    const serverId = groupIdToServer(groupId)
    for (let attempt = 0; attempt < 3; attempt++) {
      await catchUpChat(groupId)
      // A commit made but never sent, after a crash or a failed post, would block this one. A
      // sent one is among the candidates by now, and the catch-up above settled it.
      await call('discardCommit', groupId).catch(() => {})
      const before = groups[groupId]
      const change = await make()
      const result = await apiClient().e2eePostChatCommit(serverId, {
        epoch: change.epoch,
        commit: toBase64(change.commit),
        ...(change.welcome && meta.added?.length && { welcome: toBase64(change.welcome) }),
        ...(meta.added?.length && { added: meta.added }),
        ...(meta.removed?.length && { removed: meta.removed }),
        ...(meta.admins?.length && { admins: meta.admins }),
        ...(meta.members?.length && { members: meta.members }),
      })
      // The candidates of the epoch settle a sent commit, on every device alike: the core merges
      // this device's own when it came first, and drops it for the winner otherwise
      // (wire.md 7.5). confirmCommit is for the phase 1 log only.
      await catchUpChat(groupId)
      if (!result.accepted) continue
      for (const warning of result.warnings) chat.notify(warning, { error: true })
      const after = before && (await refreshGroupView(groupId))
      if (before && after)
        await recordEvents(
          commitEvents(
            before,
            after,
            {
              committer: { account: account.value, deviceId: info.value.deviceId! },
              epoch: change.epoch,
              removedSelf: false,
            },
            Date.parse(result.position.at) || Date.now(),
            new Set(leftGroup[groupId] ?? []),
          ),
        )
      client?.announce('groups')
      return true
    }
    return false
  }

  /**
   * Chores of a group member: answering rejoin requests (the account's own devices at once, an
   * admin after a pause), removing people who declined or left (admins), and removing devices
   * that an account's newest signed device list no longer names.
   */
  async function tendGroups() {
    for (const [groupId, view] of Object.entries(groups)) {
      const c = chats[groupId]
      if (!c || c.state !== 'joined') continue
      const admin = isGroupAdmin(view, account.value)
      const rejoins = await apiClient()
        .e2eeRejoins(groupIdToServer(groupId))
        .catch(() => undefined)
      for (const r of rejoins?.items ?? []) {
        const own = sameAccount(r.account, account.value)
        if (own && r.deviceId === info.value.deviceId) continue
        if (!own && !(admin && Date.now() - Date.parse(r.createdAt) > 20_000)) continue
        try {
          await commitChat(
            groupId,
            () => call<Change>('readmit', groupId, fromBase64(r.keyPackage), r.account),
            { added: [r.account] },
          )
          await apiClient()
            .e2eeDeleteRejoin(r.id)
            .catch(() => {})
        } catch (error) {
          // A request that is invalid, already answered or not this device's to answer.
          if (error instanceof E2eeError && error.code !== 'not-admin')
            await apiClient()
              .e2eeDeleteRejoin(r.id)
              .catch(() => {})
        }
      }
      if (!admin) continue
      const gone = [...c.declined, ...(leftGroup[groupId] ?? [])].filter(
        (a, i, all) =>
          !sameAccount(a, account.value) &&
          view.members.some((m) => sameAccount(m.account, a)) &&
          all.findIndex((b) => sameAccount(a, b)) === i,
      )
      if (gone.length)
        await commitChat(groupId, () => call<Change>('removeAccounts', groupId, gone), {
          removed: gone,
        }).catch(() => {})
    }
    await checkDeviceLists()
  }

  /** When each account's directory was last checked for a newer device list or identity. */
  const listChecked = new Map<string, number>()
  async function checkDeviceLists() {
    const people = new Map<string, string>()
    for (const v of Object.values(groups))
      for (const m of v.members)
        if (!sameAccount(m.account, account.value)) people.set(m.account.toLowerCase(), m.account)
    for (const [key, person] of people) {
      if (Date.now() - (listChecked.get(key) ?? 0) < 5 * 60_000) continue
      listChecked.set(key, Date.now())
      const dir = await apiClient()
        .e2eeAccount(person)
        .catch(() => undefined)
      if (!dir) continue
      try {
        const trust = await call<string>('pinIdentity', person, fromBase64(dir.identityKey))
        pins[person] = { verified: trust === 'verified' }
      } catch (error) {
        if (error instanceof E2eeError && error.code === 'identity-changed')
          await noteIdentityChange(error)
        continue
      }
      if (!dir.deviceList) continue
      const checked = await call<{ devices: string[] }>(
        'checkDeviceList',
        fromBase64(dir.deviceList.list),
      ).catch(() => undefined)
      if (!checked) continue
      for (const [groupId, view] of Object.entries(groups)) {
        const stale = staleDevices(view, person, checked.devices)
        if (stale.length && chats[groupId] && isGroupAdmin(view, account.value))
          await commitChat(groupId, () => call<Change>('removeDevices', groupId, stale)).catch(
            () => {},
          )
      }
    }
  }

  /** The server says an encrypted chat changed: sync now instead of at the next poll. */
  let changeTimer: ReturnType<typeof setTimeout> | undefined
  function changed(change: ChatChange) {
    if (!booted) return
    if (change.reason === 'notice' && !change.account && !change.groupId) {
      // This account's own state: keys found on another server, or set up again.
      void settle().catch(() => {})
      return
    }
    if (change.account) {
      listChecked.delete(change.account.toLowerCase())
      checkedPeers.delete(change.account)
    }
    clearTimeout(changeTimer)
    changeTimer = setTimeout(() => {
      void sync().then(() => {
        failures.clear()
        retries.value++
      })
    }, 250)
  }

  // A commit this device made and posted, until it knows whether the log took it. It is kept in
  // this browser's storage, so a tab that closes in between leaves the answer to the next one.
  const pendingKey = (groupId: string) => `ircord.${auth.account?.id}.e2ee-commit.${groupId}`
  const pendingCommit = (groupId: string) =>
    readLocal(pendingKey(groupId), (v) =>
      v && typeof v === 'object' && 'epoch' in v && 'commit' in v
        ? (v as { epoch: number; commit: string })
        : undefined,
    )

  /**
   * Settles a commit whose fate this device does not know: merged when the log holds exactly it
   * at its epoch, dropped when the log holds another one or none. Returns false while the log
   * cannot be read, so nothing is guessed.
   */
  async function settlePending(groupId: string) {
    const pending = pendingCommit(groupId)
    if (!pending) return true
    const page = await apiClient()
      .e2eeCommits(groupId, pending.epoch)
      .catch(() => undefined)
    if (!page) return false
    const logged = page.items.find((c) => c.epoch === pending.epoch)
    if (logged && logged.commit === pending.commit)
      await call('confirmCommit', groupId).catch(() => {})
    else await call('discardCommit', groupId).catch(() => {})
    writeLocal(pendingKey(groupId), null)
    return true
  }

  /** Applies a group's commits from this device's epoch on. */
  async function catchUp(groupId: string) {
    if (!(await settlePending(groupId))) return
    for (;;) {
      const epoch = await call<number>('epoch', groupId).catch(() => -1)
      if (epoch < 0) return
      const page = await apiClient()
        .e2eeCommits(groupId, epoch)
        .catch(() => undefined)
      const commits = page?.items.filter((c) => c.epoch >= epoch) ?? []
      if (!commits.length) return
      for (const commit of commits) {
        const apply = () =>
          call<{ removedSelf: boolean }>('processCommit', fromBase64(commit.commit))
        try {
          let applied: { removedSelf: boolean }
          try {
            applied = await apply()
          } catch {
            // A commit this device made but never posted (it is recorded before posting) blocks
            // every other one: drop it and try again.
            await call('discardCommit', groupId).catch(() => {})
            applied = await apply()
          }
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
    make: () => Promise<Change>,
    welcomeFor: { account: string; deviceId: string }[] = [],
  ) {
    // A chat carried over IRC: the Welcome goes to each added account's server.
    if (chats[groupId])
      return commitChat(groupId, make, {
        added: [...new Set(welcomeFor.map((d) => d.account))],
      })
    if (!(await settlePending(groupId))) return false
    for (let attempt = 0; attempt < 3; attempt++) {
      const change = await make()
      const commit = toBase64(change.commit)
      writeLocal(pendingKey(groupId), { epoch: change.epoch, commit })
      try {
        await apiClient().e2eePostCommit(groupId, {
          epoch: change.epoch,
          commit,
          ...(change.groupInfo && { groupInfo: toBase64(change.groupInfo) }),
          ...(change.welcome && {
            welcomes: welcomeFor.map((d) => ({ ...d, welcome: toBase64(change.welcome!) })),
          }),
        })
      } catch (error) {
        if (!status409(error)) {
          // A timeout or a server error may have stored it anyway: the log decides.
          await settlePending(groupId)
          throw error
        }
        await call('discardCommit', groupId).catch(() => {})
        writeLocal(pendingKey(groupId), null)
        await catchUp(groupId)
        continue
      }
      await call('confirmCommit', groupId)
      writeLocal(pendingKey(groupId), null)
      return true
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
    // A group whose chat the server carries over IRC keeps its commits there.
    if (chats[record.groupId] && !record.transport) record = { ...record, transport: 'irc' }
    conversations[record.conversationId] = record
    await call('putConversation', toRaw(record))
    client?.announce('conversations')
  }

  /**
   * Binds this account's side of a conversation to a group on the server, only if the server
   * already names that group as the conversation's current one. A device that joined or read a
   * group never changes which group is current: a Welcome or a message read late would otherwise
   * bring back a group that was turned off since. Starting encryption replaces groups; this never.
   * A Welcome can arrive just before its starter binds the group, so the group's "turned on"
   * event tries again; once bound, a group is not asked for again in this session.
   */
  const boundGroups = new Set<string>()
  async function bindExisting(conversationId: string, groupId: string, peer: string) {
    // A chat carried over IRC binds the conversation when it is joined.
    if (boundGroups.has(`${conversationId}:${groupId}`) || chats[groupId]) return
    await apiClient()
      .e2eeBindConversation(conversationId, { groupId, peer, replaces: groupId })
      .then(() => boundGroups.add(`${conversationId}:${groupId}`))
      .catch(() => {})
  }

  /**
   * Ends the server's binding of a conversation to a group, if that group is still current. The
   * call changes nothing when the group was turned off or replaced already.
   */
  async function unbind(conversationId: string, groupId: string) {
    boundGroups.delete(`${conversationId}:${groupId}`)
    if (chats[groupId] || conversations[conversationId]?.transport === 'irc') {
      // Leaving a direct chat carried over IRC accepts plaintext on this side again.
      await apiClient()
        .e2eeLeaveChat(groupIdToServer(groupId))
        .catch((error) => {
          if (!status404(error)) throw error
        })
      delete chats[groupId]
      return
    }
    await apiClient().e2eeTurnOff(conversationId, groupId)
  }

  /** A group this device joined: the conversation with that person is encrypted from now on. */
  async function bindJoined(groupId: string, peer: string, conversationId?: string) {
    const c = conversationId
      ? chat.data?.conversations.find((x) => x.id === conversationId)
      : conversationWith(peer)
    if (!c) return
    const current = conversations[c.id]
    if (!joinTurnsOn(current, groupId)) return
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
    await bindExisting(c.id, groupId, peer)
  }

  async function noteIdentityChange(error: { account?: string; presented?: Uint8Array }) {
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
  /** Each group's other person, as MLS (not the server) says. */
  const groupPeers = reactive<Record<string, string>>({})
  async function refreshGroups() {
    const groups = await call<{ groupId: string; peer: string }[]>('groups').catch(() => [])
    for (const id of Object.keys(groupPeers)) delete groupPeers[id]
    for (const g of groups) groupPeers[g.groupId] = g.peer
    return groups
  }
  const samePeer = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
  /**
   * Encryption works on the home network only: in direct, non-party conversations, and in an
   * encrypted group's own channel, named after its ID.
   */
  const eligible = (conversationId: string) => {
    const c = chat.conversationSettings(conversationId)
    if (!c || c.party || c.networkId !== homeNetwork.value?.id) return false
    return c.kind === 'direct' || (c.kind === 'channel' && !!groupOfChannel(c.name))
  }
  /** The encrypted group a channel conversation belongs to, as this device recorded it. */
  const groupOf = (conversationId: string) => {
    const record = conversations[conversationId]
    return record?.kind === 'group' ? record : undefined
  }
  /** Whether a conversation is an encrypted group's channel, recorded here or not. */
  const isGroupChannel = (c: Pick<Conversation, 'kind' | 'name'> | undefined) =>
    !!c && c.kind === 'channel' && !!groupOfChannel(c.name)
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
    const peer = peerOf(c)
    return startBlockerFor({
      networkId: c.networkId,
      homeNetworkId: homeNetwork.value?.id,
      selfAccount: account.value,
      bot: chat.directPartner(c)?.role === 'bot',
      peer,
      ready: ready.value,
      peerHasKeys: peerKeys[peer.toLowerCase()],
      peerUnreachable: peerUnreachable[peer.toLowerCase()],
      acrossServers: acrossServers.value,
    })
  }
  /**
   * What stops encryption with a person before a direct conversation exists, for the person menu.
   * An account the network has not reported yet does not block, and neither do the person's
   * keys: the dialog looks both up again, so a stale answer here would not lock anyone out.
   */
  function personBlocker(person: Member, networkId: string): StartBlocker | undefined {
    const known =
      person.account && person.account !== '*'
        ? person.account
        : whoisAccounts[person.nick.toLowerCase()]
    return startBlockerFor({
      networkId,
      homeNetworkId: homeNetwork.value?.id,
      selfAccount: account.value,
      bot: person.role === 'bot',
      peer: known || (person.account === '*' ? '' : undefined),
      ready: ready.value,
    })
  }
  /** Whether people have published keys, as far as this session checked. */
  const peerKeys = reactive<Record<string, boolean>>({})
  /** Why a person's keys could not be read: their IRCord server did not answer. */
  const peerUnreachable = reactive<Record<string, boolean>>({})
  async function checkPeerKeys(peer: string) {
    const key = peer.toLowerCase()
    try {
      const dir = await apiClient().e2eeAccount(peer)
      delete peerUnreachable[key]
      // Another IRCord server answered over IRC: it lists devices, and hands out their key
      // packages only when claimed.
      peerKeys[key] =
        dir.source === 'network'
          ? dir.devices.length > 0
          : dir.devices.some((d) => d.keyPackages > 0 || d.lastResort)
    } catch (error) {
      if (status404(error)) peerKeys[key] = false
      else if (error instanceof ApiError && error.status === 504) peerUnreachable[key] = true
    }
    return peerKeys[key]
  }
  /** The readable reason a person's keys are not available, for errors and the dialog. */
  function keysMissingText(peer: string, name: string) {
    if (peerUnreachable[peer.toLowerCase()]) return t('encryption.blocked.peerNoAnswer', { name })
    return acrossServers.value
      ? t('encryption.blocked.peerNoKeysAcross', { name })
      : t('encryption.blocked.peerNoKeys', { name })
  }

  /**
   * Makes a group this device just started the conversation's current group, replacing `current`
   * when the server named one. After encryption was turned off the server names none to this
   * side, yet an older client that missed the "off" may have made an old group current again, and
   * the server then refuses with 409. That group is one this device shares with the person, so
   * each of those is tried as the one to replace.
   */
  async function bindStarted(conversationId: string, groupId: string, peer: string, current = '') {
    const bind = (replaces: string) =>
      apiClient().e2eeBindConversation(conversationId, {
        groupId,
        peer,
        ...(replaces && replaces !== groupId && { replaces }),
      })
    try {
      await bind(current)
    } catch (error) {
      if (!status409(error)) throw error
      await refreshGroups()
      const older = Object.keys(groupPeers).filter(
        (id) => id !== groupId && id !== current && samePeer(groupPeers[id], peer),
      )
      for (const old of older) {
        try {
          await bind(old)
          return
        } catch (retry) {
          if (!status409(retry)) throw retry
        }
      }
      throw error
    }
  }

  /**
   * Reads a person's directory and pins their identity key on first sight. Throws a readable
   * Error when their keys changed since and the change waits for acknowledgment.
   */
  async function pinPerson(person: string, name = person) {
    const dir = await apiClient().e2eeAccount(person)
    try {
      const trust = await call<string>('pinIdentity', person, fromBase64(dir.identityKey))
      pins[person] = { verified: trust === 'verified' }
    } catch (error) {
      if (error instanceof E2eeError && error.code === 'identity-changed') {
        await noteIdentityChange(error)
        throw new Error(t('encryption.reset.acknowledgeFirst', { name }), { cause: error })
      }
      throw error
    }
    return dir
  }

  /**
   * Starts a direct chat carried over IRC, which reaches the person whichever IRCord server of
   * the home network they use. The server binds the conversation and delivers the Welcome to
   * the person's server. Welcomes over IRC reach other accounts only, so of this account only
   * this device takes part; the account's other devices see the chat as unreadable.
   */
  async function startChat(c: Conversation, peer: string, theirs: { keyPackage: string }[]) {
    const started = await call<{ groupId: string; welcome: Uint8Array }>(
      'startDm',
      peer,
      theirs.map((i) => fromBase64(i.keyPackage)),
    )
    const previous = conversations[c.id]
    try {
      const created = await apiClient().e2eeCreateChat({
        groupId: groupIdToServer(started.groupId),
        kind: 'direct',
        conversationId: c.id,
        peer,
        epoch: await call<number>('epoch', started.groupId),
        welcome: toBase64(started.welcome),
        ...(previous?.groupId && { replaces: groupIdToServer(previous.groupId) }),
      })
      chats[started.groupId] = created.chat
    } catch (error) {
      await call('forgetGroup', started.groupId).catch(() => {})
      throw error
    }
    await saveConversation({
      conversationId: c.id,
      groupId: started.groupId,
      peer,
      on: true,
      by: account.value,
      at: Date.now(),
      transport: 'irc',
    })
    await refreshGroups()
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
    const name = chat.directPartner(c)?.nick ?? c.name
    if (!(await checkPeerKeys(peer))) throw new Error(keysMissingText(peer, name))
    await flow(async () => {
      await pinPerson(peer, name)
      const theirs = await apiClient().e2eeClaim(peer)
      if (acrossServers.value) {
        await startChat(c, peer, theirs.items)
        return
      }
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
      await bindStarted(c.id, started.groupId, peer, server?.groupId)
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
    try {
      await unbind(c.id, record.groupId)
    } catch (error) {
      // 404: this account has no binding left, because the other person's client already ended
      // it on reading the notice. Nothing is left to undo.
      if (!status404(error)) {
        if (!status409(error)) throw error
        // 409: the server still names another group, bound again by a client that missed an
        // earlier "off". When it is one of this person's groups, it ends too; otherwise the
        // server would keep refusing plaintext while this side shows encryption as off.
        const server = await apiClient()
          .e2eeConversation(c.id)
          .catch(() => undefined)
        await refreshGroups()
        if (!server?.groupId || !samePeer(groupPeers[server.groupId], record.peer)) throw error
        await unbind(c.id, server.groupId)
      }
    }
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
    if (record.kind === 'group') {
      if (fellOut[record.groupId]) return t('encryption.group.fellOutComposer')
      if (!groups[record.groupId]) return t('encryption.group.notMember')
      return undefined
    }
    if (notices.value.some((n) => n.account === record.peer))
      return t('encryption.reset.acknowledgeFirst', { name: record.peer })
    return undefined
  }

  /** The current group of an encrypted conversation, replacing one that was forgotten. */
  async function activeGroup(conversationId: string) {
    const record = conversations[conversationId]!
    if (record.kind === 'group') {
      if (groups[record.groupId]) return record.groupId
      throw new Error(t('encryption.group.notMember'))
    }
    await refreshGroups()
    // A group counts only if MLS says it is a DM with this conversation's person.
    if (samePeer(groupPeers[record.groupId], record.peer)) return record.groupId
    // The other person started fresh and already made a replacement group this device joined.
    const server = await apiClient()
      .e2eeConversation(conversationId)
      .catch(() => undefined)
    if (server?.groupId && samePeer(groupPeers[server.groupId], record.peer)) {
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
        // A ciphertext dropped into a channel is never decrypted there.
        eligible(m.conversationId) &&
        // Already read, unless this is the echo that tells this device its own message's ID.
        (!plain.has(m.encrypted.payload) ||
          (!plain.get(m.encrypted.payload)!.messageId && !m.id.startsWith('pending-'))) &&
        !failures.has(m.encrypted.payload) &&
        !queued.has(m.encrypted.payload),
    )
    if (!fresh.length || !client) return
    for (const m of fresh) queued.add(m.encrypted!.payload)
    ingesting = ingesting.then(() => receiveAll(fresh)).catch(() => {})
  }

  async function receiveAll(messages: Message[]) {
    await loaded
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
    // In a group, only "left" changes anything here: an admin's client removes that person.
    if (
      current?.kind === 'group' ||
      isGroupChannel(chat.conversationSettings(message.conversationId))
    ) {
      if (payload.t === 'control' && payload.op === 'left' && current?.groupId === record.groupId) {
        const list = leftGroup[record.groupId] ?? []
        if (!list.some((a) => sameAccount(a, record.account)))
          leftGroup[record.groupId] = [...list, record.account]
        if (isGroupAdmin(groups[record.groupId], account.value)) void sync()
      }
      return
    }
    // History is read again on every load and late on a device that was offline: the rules are
    // in shared/e2ee/state.ts. Only the conversation's own current group can turn it off, so a
    // server cannot replay a genuine "off" from another chat here.
    const op = payload.t === 'control' ? payload.op : undefined
    // "Left" belongs to groups; in a direct chat it changes nothing.
    if (op === 'left') return
    const change = eventChange(current, { groupId: record.groupId, op, at: record.at })
    if (change === 'on') await turnedOn(message.conversationId, record)
    else if (change === 'off') {
      await saveConversation({ ...toRaw(current!), on: false, by: record.account, at: record.at })
      // A device of this account may have bound the group after the other person turned it off.
      await unbind(message.conversationId, record.groupId).catch(() => {})
    } else if (op === 'encryption-on' && current?.on && current.groupId === record.groupId)
      await bindExisting(message.conversationId, record.groupId, current.peer)
  }

  /**
   * Records a conversation as encrypted in the record's group: only when MLS says that group is a
   * DM with this conversation's person. The server binding follows when that group is current.
   */
  async function turnedOn(conversationId: string, record: PlainRecord) {
    const c = chat.conversationSettings(conversationId)
    if (!c || !eligible(conversationId)) return
    await refreshGroups()
    const peer = groupPeers[record.groupId]
    const expected = conversations[conversationId]?.peer || (await resolvePeer(c))
    if (!samePeer(peer, expected) || !peer) return
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
    await bindExisting(conversationId, record.groupId, peer)
  }

  /** Loads what this device stored for a conversation: edits and reactions apply to older messages. */
  const serverChecked = new Set<string>()
  async function open(conversationId: string) {
    if (!client) return
    await loaded
    if (!stored.has(conversationId)) {
      const records = await call<PlainRecord[]>('conversationPlain', conversationId).catch(() => [])
      stored.set(conversationId, records)
    }
    // A device without its own record (new, or after starting fresh) takes the server's word
    // that a conversation is encrypted, so it never offers to send plaintext into it.
    const c = chat.conversationSettings(conversationId)
    if (
      c &&
      c.kind === 'direct' &&
      eligible(conversationId) &&
      !serverChecked.has(conversationId) &&
      !conversations[conversationId]
    ) {
      serverChecked.add(conversationId)
      const server = await apiClient()
        .e2eeConversation(conversationId)
        .catch(() => undefined)
      if (server?.encrypted && !conversations[conversationId]) {
        // The server's word turns encryption on, never off, and never picks the person: the
        // group is used only if MLS says it is a DM with the person this chat resolves to.
        await refreshGroups()
        const peer = (await resolvePeer(c)) || server.peer || ''
        const groupId =
          server.groupId && samePeer(groupPeers[server.groupId], peer) ? server.groupId : ''
        if (peer && !conversations[conversationId])
          await saveConversation({ conversationId, groupId, peer, on: true, at: Date.now() })
      }
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
    const c = chat.conversationSettings(message.conversationId)
    const partner = c ? chat.directPartner(c)?.id : undefined
    let record = message.encrypted ? plain.get(message.encrypted.payload) : undefined
    let failure = message.encrypted ? failures.get(message.encrypted.payload) : undefined
    const inGroup = isGroupChannel(c)
    if (message.encrypted && !eligible(message.conversationId)) {
      record = undefined
      failure = t('encryption.message.unreadable')
    } else if (record && !record.own && inGroup) {
      // A group's channel is named after its ID: a ciphertext of any other group, or a direct
      // chat, that the server shows here is not this group's.
      if (record.groupId !== groupOfChannel(c?.name ?? '')) {
        record = undefined
        failure = t('encryption.message.wrongConversation')
      }
    } else if (record && !record.own) {
      // The server says which conversation a ciphertext belongs to; MLS says whose it is. A
      // message from another chat's group, or from someone else, is not shown as this chat's.
      const expected = conversation?.peer || (c ? peerOf(c) : '')
      const group = groupPeers[record.groupId]
      const fromHere =
        samePeer(record.account, account.value) || !expected || samePeer(record.account, expected)
      if ((group && expected && !samePeer(group, expected)) || !fromHere) {
        record = undefined
        failure = t('encryption.message.wrongConversation')
      }
    }
    return presentMessage(message, {
      record,
      failure,
      effects: effects.value.get(message.conversationId),
      conversation,
      selfAccount: account.value,
      partnerId: partner,
      ...(inGroup && { memberIdOf: (a: string) => memberIdFor(message.conversationId, a) }),
      nickOf: (id) => chat.member(id)?.nick ?? '',
    })
  }

  /** The member ID of an account in a conversation, for reactions and reply quotes in a group. */
  function memberIdFor(conversationId: string, person: string) {
    const c = chat.conversationSettings(conversationId)
    if (!c) return ''
    return (
      c.memberIds?.find((id) => sameAccount(chat.member(id, c.networkId)?.account, person)) ?? ''
    )
  }

  /**
   * An encrypted group's timeline lines (who added, removed or promoted whom) as messages, for
   * the timeline to sort in among the others.
   */
  function groupEventMessages(conversationId: string): Message[] {
    const record = groupOf(conversationId)
    if (!record) return []
    return groupEvents.value
      .filter((e) => e.groupId === record.groupId)
      .map(
        (e) =>
          ({
            id: `e2ee-event-${e.id}`,
            clientId: `e2ee-event-${e.id}`,
            conversationId,
            senderId: '',
            kind: 'notice',
            text: '',
            createdAt: new Date(e.at).toISOString(),
            reactions: [],
            e2ee: { state: 'ok', groupEvent: e },
          }) as unknown as Message,
      )
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

  // ---- Encrypted groups ------------------------------------------------------------------------

  /** Invitations to groups that this device opened: the title comes from MLS. */
  const invitations = computed(() =>
    Object.entries(chats)
      .filter(([id, c]) => c.kind === 'group' && c.state === 'invited' && groups[id])
      .map(([id, c]) => ({ groupId: id, title: groups[id]!.title, inviter: c.inviter ?? '' })),
  )

  /** The lock of a group's header and its verification count. */
  function groupLockFor(conversationId: string) {
    const record = groupOf(conversationId)
    const view = record ? groups[record.groupId] : undefined
    return groupLock({
      view,
      self: account.value,
      pins,
      changed: notices.value.map((n) => n.account),
      trouble: !ready.value || (!!record && !!fellOut[record.groupId]),
    })
  }

  /** Claims one key package per device of each person, after pinning their identity. */
  async function claimPeople(people: string[]) {
    const packages: Uint8Array[] = []
    const accounts: string[] = []
    for (const person of people) {
      if (!(await checkPeerKeys(person))) throw new Error(keysMissingText(person, person))
      await pinPerson(person)
      const claim = await apiClient().e2eeClaim(person)
      if (!claim.items.length) throw new Error(keysMissingText(person, person))
      packages.push(...claim.items.map((i) => fromBase64(i.keyPackage)))
      accounts.push(claim.account)
    }
    return { packages, accounts }
  }

  /**
   * Creates an encrypted group with a title and people (their accounts). The server registers the
   * group's channel, gives each person the right to enter it and sends them the Welcome over IRC.
   * Returns the channel conversation's ID once the server reports it.
   */
  async function createGroup(title: string, people: string[]) {
    const wanted = [...new Set(people.map((p) => p.trim()).filter(Boolean))].filter(
      (p) => !sameAccount(p, account.value),
    )
    if (!wanted.length) throw new Error(t('encryption.group.needPeople'))
    if (wanted.length + 1 > GROUP_MAX_ACCOUNTS)
      throw new Error(t('encryption.group.tooMany', { count: GROUP_MAX_ACCOUNTS }))
    return flow(async () => {
      const { packages, accounts } = await claimPeople(wanted)
      const created = await call<{ groupId: string; welcome: Uint8Array }>(
        'createGroup',
        title.trim(),
        packages,
      )
      let answer: Awaited<ReturnType<ReturnType<typeof apiClient>['e2eeCreateChat']>>
      try {
        answer = await apiClient().e2eeCreateChat({
          groupId: groupIdToServer(created.groupId),
          kind: 'group',
          members: accounts,
          epoch: await call<number>('epoch', created.groupId),
          welcome: toBase64(created.welcome),
        })
      } catch (error) {
        await call('forgetGroup', created.groupId).catch(() => {})
        throw error
      }
      for (const warning of answer.warnings) chat.notify(warning, { error: true })
      chats[created.groupId] = answer.chat
      const view = await refreshGroupView(created.groupId)
      await recordEvents([
        {
          id: `${created.groupId}:created`,
          groupId: created.groupId,
          at: Date.now(),
          kind: 'created',
          by: account.value,
          subject: view?.title ?? title,
        },
      ])
      if (answer.chat.conversationId)
        await saveConversation({
          conversationId: answer.chat.conversationId,
          groupId: created.groupId,
          peer: '',
          on: true,
          kind: 'group',
          transport: 'irc',
          title: view?.title ?? title,
          by: account.value,
          at: Date.now(),
        })
      return answer.chat.conversationId ?? ''
    })
  }

  /** Accepts an invitation: enters the group's channel. Returns its conversation ID. */
  async function joinInvitation(groupId: string) {
    const answer = await apiClient().e2eeJoinChat(groupIdToServer(groupId))
    chats[groupId] = answer
    const view = groups[groupId]
    if (answer.conversationId && view)
      await saveConversation({
        conversationId: answer.conversationId,
        groupId,
        peer: '',
        on: true,
        kind: 'group',
        transport: 'irc',
        title: view.title,
        by: answer.inviter,
        at: Date.now(),
      })
    void sync()
    return answer.conversationId ?? ''
  }

  /** Declines an invitation: the inviter's client removes this account from the group. */
  async function declineInvitation(groupId: string) {
    await apiClient().e2eeDeclineChat(groupIdToServer(groupId))
    delete chats[groupId]
    await call('forgetGroup', groupId).catch(() => {})
    delete groups[groupId]
  }

  /** The group of a conversation, for the group actions below. */
  function needGroup(conversationId: string) {
    const record = groupOf(conversationId)
    if (!record || !groups[record.groupId]) throw new Error(t('encryption.group.notMember'))
    return record.groupId
  }

  /** Adds people to a group (an admin): their devices join from the Welcome. */
  async function addPeople(conversationId: string, people: string[]) {
    const groupId = needGroup(conversationId)
    const view = groups[groupId]!
    const wanted = [...new Set(people.map((p) => p.trim()).filter(Boolean))].filter(
      (p) => !view.members.some((m) => sameAccount(m.account, p)),
    )
    if (!wanted.length) return
    if (view.members.length + wanted.length > GROUP_MAX_ACCOUNTS)
      throw new Error(t('encryption.group.tooMany', { count: GROUP_MAX_ACCOUNTS }))
    await flow(async () => {
      const { packages, accounts } = await claimPeople(wanted)
      if (
        !(await commitChat(groupId, () => call<Change>('addDevices', groupId, packages), {
          added: accounts,
        }))
      )
        throw new Error(t('encryption.group.busy'))
    })
  }

  /** Removes a person from a group (an admin): their devices can read nothing sent after. */
  async function removePerson(conversationId: string, person: string) {
    const groupId = needGroup(conversationId)
    await flow(async () => {
      if (
        !(await commitChat(groupId, () => call<Change>('removeAccounts', groupId, [person]), {
          removed: [person],
        }))
      )
        throw new Error(t('encryption.group.busy'))
    })
  }

  /** Makes a member an admin, or an ordinary member again (an admin). */
  async function setAdmin(conversationId: string, person: string, admin: boolean) {
    const groupId = needGroup(conversationId)
    await flow(async () => {
      if (
        !(await commitChat(
          groupId,
          () => call<Change>('setAdmin', groupId, person, admin),
          admin ? { admins: [person] } : { members: [person] },
        ))
      )
        throw new Error(t('encryption.group.busy'))
    })
  }

  /** Hands the group over to another member (the creator), who becomes its creator. */
  async function handOver(conversationId: string, person: string) {
    const groupId = needGroup(conversationId)
    await flow(async () => {
      if (
        !(await commitChat(groupId, () => call<Change>('handOver', groupId, person), {
          admins: [person],
        }))
      )
        throw new Error(t('encryption.group.busy'))
    })
  }

  /** Lets a person who started fresh back in (an admin): their old devices go, new ones join. */
  async function letBackIn(conversationId: string, person: string) {
    const groupId = needGroup(conversationId)
    await flow(async () => {
      // Letting them back in is accepting their new identity key on this device.
      const notice = notices.value.find((n) => sameAccount(n.account, person))
      if (notice) {
        await call('acceptIdentityChange', notice.account, notice.presented)
        await call('deleteNotice', notice.id)
        notices.value = notices.value.filter((n) => n.id !== notice.id)
        pins[notice.account] = { verified: false }
        client?.announce('notices')
      }
      const claim = await apiClient().e2eeClaim(person)
      if (
        !(await commitChat(
          groupId,
          () =>
            call<Change>(
              'letBackIn',
              groupId,
              person,
              claim.items.map((i) => fromBase64(i.keyPackage)),
            ),
          { added: [person] },
        ))
      )
        throw new Error(t('encryption.group.busy'))
    })
  }

  /**
   * Leaves a group: an encrypted "left" notice first, so the others see it, then the channel. An
   * admin's client removes this account's devices. With `close`, the creator ends the group for
   * everyone: its channel registration is removed.
   */
  async function leaveGroup(conversationId: string, close = false) {
    const record = groupOf(conversationId)
    if (!record) return
    const view = groups[record.groupId]
    if (!close && view && sameAccount(view.creator, account.value))
      throw new Error(t('encryption.group.creatorLeave'))
    if (!close && view) {
      await sendPayload(conversationId, { v: 1, id: newPayloadId(), t: 'control', op: 'left' })
      // The notice goes out before this account parts the channel.
      for (let i = 0; i < 50 && (chat.outbox[conversationId]?.length ?? 0) > 0; i++)
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await apiClient()
      .e2eeLeaveChat(groupIdToServer(record.groupId), close)
      .catch((error) => {
        if (!status404(error)) throw error
      })
    delete chats[record.groupId]
    await call('forgetGroup', record.groupId).catch(() => {})
    delete groups[record.groupId]
    await saveConversation({ ...toRaw(record), on: false, by: account.value, at: Date.now() })
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

  /**
   * On a device that needs approval: shows a new approval code (as text and QR code) and waits
   * for a certificate sealed under it. See the handshake in shared/e2ee/codec.ts.
   */
  async function requestApproval(onApproved: () => void) {
    if (!info.value.device) info.value = await call<E2eeStatus>('createDevice', account.value)
    const code = newApprovalCode()
    const request = await sealApprovalRequest(code, await call<Uint8Array>('certificateRequest'))
    const deviceId = info.value.deviceId!
    const post = () =>
      apiClient()
        .e2eeRelay({ fromDevice: deviceId, toDevice: APPROVAL_MAILBOX, payload: toBase64(request) })
        .catch(() => undefined)
    await post()
    let stopped = false
    let busy = false
    const repost = setInterval(() => void post(), 8 * 60_000)
    const stop = () => {
      stopped = true
      clearInterval(poll)
      clearInterval(repost)
    }
    const poll = setInterval(async () => {
      if (stopped || busy) return
      busy = true
      try {
        const messages = await apiClient()
          .e2eeApprovals(deviceId)
          .catch(() => undefined)
        for (const item of messages?.items ?? []) {
          let answer: { certificate?: unknown } | undefined
          try {
            // Only an answer sealed under this device's code counts: the server cannot make one.
            answer = (await openHandover(code, fromBase64(item.payload))) as typeof answer
          } catch {
            continue
          }
          if (typeof answer?.certificate !== 'string') continue
          stop()
          await apiClient()
            .e2eeDeleteApproval(item.id)
            .catch(() => {})
          info.value = await call<E2eeStatus>('installCertificate', fromBase64(answer.certificate))
          try {
            await registerDevice()
            await applyHandover(answer)
          } finally {
            // A failed publish is retried by settle: this device was never registered.
            client?.announce('device')
            await settle().catch(() => {})
          }
          onApproved()
          return
        }
      } finally {
        busy = false
      }
    }, 2000)
    return { qr: approvalQr(code), code: formatApprovalCode(code), cancel: stop }
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

  /** On an approved device: how many devices wait in the account's approval mailbox. */
  async function waitingApprovals() {
    const messages = await apiClient().e2eeApprovals(APPROVAL_MAILBOX)
    return messages.items.length
  }

  /**
   * Approves the new device that shows `input` (its approval code, typed or scanned): certifies
   * its request, sends back the certificate with this device's verification marks and encrypted
   * chat list, sealed under the code, then adds the device to every group. Throws when no waiting
   * request was made with that code.
   */
  async function approve(input: string) {
    const code = parseApprovalQr(input) ?? normalizeApprovalCode(input)
    if (!code) throw new Error(t('encryption.approval.badCode'))
    const messages = await apiClient().e2eeApprovals(APPROVAL_MAILBOX)
    let found: { id: number; request: Uint8Array } | undefined
    for (const item of messages.items) {
      const request = await openApprovalRequest(code, fromBase64(item.payload))
      if (request) {
        found = { id: item.id, request }
        break
      }
    }
    if (!found) throw new Error(t('encryption.approval.notFound'))
    const deviceId = requestDevice(found.request)
    const certificate = await call<Uint8Array>('certifyDevice', found.request)
    const verified: { account: string; identityKey: string }[] = []
    for (const peer of new Set(Object.values(conversations).map((c) => c.peer))) {
      const pin = await call<{ identityKey: Uint8Array; verified: boolean } | undefined>(
        'pin',
        peer,
      )
      if (pin?.verified) verified.push({ account: peer, identityKey: toBase64(pin.identityKey) })
    }
    const sealed = await sealHandover(code, {
      certificate: toBase64(certificate),
      verified,
      conversations: Object.values(conversations).map((c) => toRaw(c)),
    })
    await apiClient().e2eeRelay({
      fromDevice: info.value.deviceId!,
      toDevice: deviceId,
      payload: toBase64(sealed),
    })
    await apiClient()
      .e2eeDeleteApproval(found.id)
      .catch(() => {})
    const request = { deviceId }
    // The new device publishes its key packages once it installed the certificate.
    for (let i = 0; i < 90; i++) {
      const own = await apiClient().e2eeOwnDirectory()
      directory.value = own
      if (own.devices.some((d) => d.deviceId === request.deviceId && d.keyPackages > 0)) break
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    await addOwnDevice(request.deviceId)
    await publishDeviceList().catch(() => {})
  }

  /** Adds one of this account's devices to every group this device is in. */
  async function addOwnDevice(deviceId: string) {
    await flow(async () => {
      const list = await call<{ groupId: string }[]>('coreConversations')
      for (const group of list) {
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
    await flow(async () => {
      await removeSignedOutDevices(await call<{ groupId: string }[]>('coreConversations'))
      await publishDeviceList().catch(() => {})
    })
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
    chats,
    groups,
    groupEvents,
    fellOut,
    groupDialog,
    acrossServers,
    groupsAvailable,
    invitations,
    groupOf: computed(() => groupOf),
    isGroupChannel: computed(() => isGroupChannel),
    groupLockFor: computed(() => groupLockFor),
    groupEventMessages: computed(() => groupEventMessages),
    memberIdFor,
    createGroup,
    joinInvitation,
    declineInvitation,
    addPeople,
    removePerson,
    setAdmin,
    handOver,
    letBackIn,
    leaveGroup,
    changed,
    isEncrypted: computed(() => isEncrypted),
    present: computed(() => present),
    startBlocker: computed(() => startBlocker),
    personBlocker: computed(() => personBlocker),
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
    waitingApprovals,
    approve,
    removeDevice,
    startFresh,
    signOut,
    sync,
    settle,
  }
})

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(useE2eeStore, import.meta.hot))
