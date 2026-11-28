/// <reference lib="webworker" />
/**
 * End-to-end encryption (experimental, ircord/issues#19): the one place that holds this device's
 * keys. The encryption core (app/e2ee/vendor, built from ircord/e2ee) runs here, in one worker per
 * account, started only by the tab that holds the account's encryption lock
 * (app/utils/e2ee-client.ts). Other tabs reach it through that tab, so there is exactly one
 * writer of the device state and of the local store of decrypted messages.
 *
 * Every call runs alone and in order. A call that changes the device state returns only after
 * the new state is written to IndexedDB, so nothing the core produced (a ciphertext, a commit)
 * can leave this device before the state that matches it is durable.
 */
import init, { E2eeDevice, envelopeClass } from '../e2ee/vendor/ircord_e2ee_wasm.js'
import wasmUrl from '../e2ee/vendor/ircord_e2ee_wasm_bg.wasm?url'
import {
  E2EE_DB_PREFIX,
  plainTokens,
  type ConversationRecord,
  type E2eeErrorShape,
  type E2eeStatus,
  type GroupEventRecord,
  type NoticeRecord,
  type PlainRecord,
} from '../../shared/e2ee/types'

const STATE = 'state'
const PLAIN = 'plain'
const CONVERSATIONS = 'conversations'
const NOTICES = 'notices'
/** Lines for an encrypted group's timeline: who added, removed or promoted whom. */
const EVENTS = 'events'

let db: IDBDatabase | undefined
/** The account whose database is open. */
let opened = ''
/** Tag characters per IRC line; the core keeps it per device instance, not in the state. */
let budget = 0
let device: E2eeDevice | undefined
/** The newest state blob the core handed over, and whether it still needs writing. */
let blob: Uint8Array | null = null
let dirty = false
let ready: Promise<void> | undefined
let queue: Promise<unknown> = Promise.resolve()

const store = {
  load: () => blob,
  save: (state: Uint8Array) => {
    blob = state
    dirty = true
  },
}

const request = <T>(value: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error)
  })
const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Encryption storage failed'))
  })

function openDb(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(name, 2)
    open.onupgradeneeded = ({ oldVersion }) => {
      const d = open.result
      if (oldVersion < 1) {
        d.createObjectStore(STATE)
        const plain = d.createObjectStore(PLAIN, { keyPath: 'key' })
        plain.createIndex('conversation', ['conversationId', 'at'])
        plain.createIndex('message', 'messageId')
        plain.createIndex('tokens', 'tokens', { multiEntry: true })
        d.createObjectStore(CONVERSATIONS, { keyPath: 'conversationId' })
        d.createObjectStore(NOTICES, { keyPath: 'id' })
      }
      if (oldVersion < 2) {
        const events = d.createObjectStore(EVENTS, { keyPath: 'id' })
        events.createIndex('group', ['groupId', 'at'])
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
    open.onblocked = () => reject(new Error('Encryption storage is in use by an older tab'))
  })
}

/** Writes the newest state blob. Called after every operation, before its result is returned. */
async function persist(records: PlainRecord[] = []) {
  if ((!dirty || !blob) && !records.length) return
  if (!db) return
  // The state and the plaintexts it produced commit together: a decrypted message whose key
  // the state already spent can never be lost between two writes.
  const tx = db.transaction([STATE, PLAIN], 'readwrite', { durability: 'strict' })
  if (dirty && blob) tx.objectStore(STATE).put(blob, 'device')
  for (const record of records) tx.objectStore(PLAIN).put(record)
  await done(tx)
  dirty = false
}

function status(): E2eeStatus {
  if (!device) return { device: false }
  return {
    device: true,
    account: device.account,
    deviceId: device.deviceId,
    holdsIdentity: device.holdsIdentity,
    certified: !!device.certificate,
    identityKey: device.identityKey ?? undefined,
  }
}

function errorShape(error: unknown): E2eeErrorShape {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown; account?: unknown; presented?: unknown }
    return {
      code: typeof e.code === 'string' ? e.code : 'error',
      message: typeof e.message === 'string' ? e.message : String(error),
      ...(typeof e.account === 'string' && { account: e.account }),
      ...(e.presented instanceof Uint8Array && { presented: e.presented }),
    }
  }
  return { code: 'error', message: String(error) }
}

function adopt(d: E2eeDevice) {
  if (budget) d.setTagBudget(budget)
  return d
}

function need() {
  if (!device)
    throw Object.assign(new Error('This device has no encryption keys yet'), { code: 'no-device' })
  return device
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function getAll<T>(name: string): Promise<T[]> {
  const tx = db!.transaction(name, 'readonly')
  return request(tx.objectStore(name).getAll() as IDBRequest<T[]>)
}

async function putRecords(name: string, records: object[]) {
  const tx = db!.transaction(name, 'readwrite')
  const os = tx.objectStore(name)
  for (const record of records) os.put(record)
  await done(tx)
}

/** The methods tabs may call. Byte values cross as Uint8Array. */
const methods: Record<string, (...args: never[]) => unknown> = {
  async open(account: string) {
    if (db && opened === account) return status()
    // Each account has its own database; sign-out deletes it (wipe).
    db = await openDb(`${E2EE_DB_PREFIX}${account}`)
    opened = account
    const tx = db.transaction(STATE, 'readonly')
    blob = ((await request(tx.objectStore(STATE).get('device'))) as Uint8Array | undefined) ?? null
    if (blob) device = adopt(E2eeDevice.open(store))
    return status()
  },
  status,
  createAccount(account: string) {
    if (device) throw Object.assign(new Error('This device already has keys'), { code: 'state' })
    device = adopt(E2eeDevice.createAccount(store, account))
    return status()
  },
  createDevice(account: string) {
    if (device) throw Object.assign(new Error('This device already has keys'), { code: 'state' })
    device = adopt(E2eeDevice.createDevice(store, account))
    return status()
  },
  /** Starting fresh: forgets this device's keys and groups. Decrypted messages stay. */
  async dropDevice() {
    device?.free()
    device = undefined
    blob = null
    dirty = false
    const tx = db!.transaction([STATE, CONVERSATIONS], 'readwrite')
    tx.objectStore(STATE).delete('device')
    tx.objectStore(CONVERSATIONS).clear()
    await done(tx)
    return status()
  },
  setTagBudget(chars: number) {
    budget = chars
    device?.setTagBudget(chars)
  },
  certificate: () => need().certificate,
  certificateRequest: () => need().certificateRequest(),
  certifyDevice: (request: Uint8Array) => need().certifyDevice(request),
  installCertificate(certificate: Uint8Array) {
    need().installCertificate(certificate)
    return status()
  },
  keyPackages: (count: number) => need().keyPackages(count) as Uint8Array[],
  lastResortKeyPackage: () => need().lastResortKeyPackage(),
  pinIdentity: (account: string, key: Uint8Array) => need().pinIdentity(account, key),
  acceptIdentityChange: (account: string, key: Uint8Array) =>
    need().acceptIdentityChange(account, key) as string[],
  setVerified: (account: string, verified: boolean) => need().setVerified(account, verified),
  pin: (account: string) => need().pin(account),
  securityCode: (peer: string) => need().securityCode(peer),
  startDm: (peer: string, keyPackages: Uint8Array[]) => need().startDm(peer, keyPackages),
  joinDm: (welcome: Uint8Array) => need().joinDm(welcome),
  groups: () => need().groups(),
  members: (groupId: string) => need().members(groupId),
  epoch: (groupId: string) => need().epoch(groupId),
  isActive: (groupId: string) => need().isActive(groupId),
  forgetGroup: (groupId: string) => need().forgetGroup(groupId),
  addDevices: (groupId: string, keyPackages: Uint8Array[]) =>
    need().addDevices(groupId, keyPackages),
  removeDevices: (groupId: string, devices: { account: string; deviceId: string }[]) =>
    need().removeDevices(groupId, devices),
  selfUpdate: (groupId: string) => need().selfUpdate(groupId),
  confirmCommit: (groupId: string) => need().confirmCommit(groupId),
  discardCommit: (groupId: string) => need().discardCommit(groupId),
  processCommit: (commit: Uint8Array) => need().processCommit(commit),

  // Groups of several accounts, and the in-band log (wire.md section 7).
  coreConversations: () => need().conversations(),
  createGroup: (title: string, keyPackages: Uint8Array[]) => need().createGroup(title, keyPackages),
  joinGroup: (welcome: Uint8Array) => need().joinGroup(welcome),
  groupSettings: (groupId: string) => need().groupSettings(groupId),
  isGroup: (groupId: string) => need().isGroup(groupId),
  removeAccounts: (groupId: string, accounts: string[]) => need().removeAccounts(groupId, accounts),
  letBackIn: (groupId: string, account: string, keyPackages: Uint8Array[]) =>
    need().letBackIn(groupId, account, keyPackages),
  setGroupTitle: (groupId: string, title: string) => need().setGroupTitle(groupId, title),
  setAdmin: (groupId: string, account: string, admin: boolean) =>
    need().setAdmin(groupId, account, admin),
  handOver: (groupId: string, account: string) => need().handOver(groupId, account),
  /** Tries one epoch's candidate commits in position order; the first the core accepts wins. */
  applyCandidates: (groupId: string, candidates: Uint8Array[]) =>
    need().applyCandidates(groupId, candidates),
  rejoinRequest: (groupId: string) => need().rejoinRequest(groupId),
  readmit: (groupId: string, request: Uint8Array, account: string) =>
    need().readmit(groupId, request, account),
  signDeviceList: (deviceIds: string[]) => need().signDeviceList(deviceIds),
  checkDeviceList: (list: Uint8Array) => need().checkDeviceList(list),
  groupEvents: () => getAll<GroupEventRecord>(EVENTS),
  putGroupEvents: (records: GroupEventRecord[]) => putRecords(EVENTS, records),

  /**
   * Encrypts a payload and keeps its plaintext, so this device can show its own message when the
   * server echoes the ciphertext (a device cannot decrypt what it sent). Returns one tag value per
   * IRC line, each `1.<class>.<payload>`.
   */
  async encrypt(
    groupId: string,
    payloadJson: string,
    meta: { conversationId: string; at: number },
  ) {
    const d = need()
    const tags = d.encrypt(groupId, payloadJson) as string[]
    const payload = JSON.parse(payloadJson)
    const records: PlainRecord[] = []
    for (const [index, tag] of tags.entries()) {
      const last = index === tags.length - 1
      const text = typeof payload.text === 'string' ? payload.text : ''
      records.push({
        key: await sha256Hex(tag.slice(4)),
        conversationId: meta.conversationId,
        groupId,
        account: d.account,
        device: d.deviceId,
        at: meta.at,
        own: true,
        ...(last
          ? { payload, tokens: plainTokens(payload.t === 'msg' ? text : '') }
          : { hidden: true }),
      })
    }
    // The state goes first: a stored plaintext without its ratchet state is harmless, the
    // reverse could reuse a message key after a crash.
    await persist(records)
    return { tags, records }
  },

  /**
   * Resolves one received ciphertext: the stored plaintext if this device has seen it (a
   * ciphertext decrypts only once), otherwise a decryption that is stored before it returns.
   * Returns the record, or throws the core's error.
   */
  async receive(
    tag: string,
    account: string,
    meta: { conversationId: string; at: number; messageId: string },
  ): Promise<PlainRecord | undefined> {
    const key = await sha256Hex(tag.slice(4))
    const tx = db!.transaction(PLAIN, 'readonly')
    const known = (await request(tx.objectStore(PLAIN).get(key))) as PlainRecord | undefined
    if (known) {
      // A ciphertext the server shows again elsewhere, or under another account, is refused,
      // as the first decryption would have refused it.
      if (known.conversationId !== meta.conversationId)
        throw Object.assign(new Error('This message belongs to another conversation'), {
          code: 'malformed',
        })
      if (!known.own && known.account.toLowerCase() !== account.toLowerCase())
        throw Object.assign(new Error('The sender does not match'), { code: 'sender-mismatch' })
      if (!known.messageId && meta.messageId) {
        known.messageId = meta.messageId
        await putRecords(PLAIN, [known])
      }
      return known
    }
    const d = need()
    const result = d.receive(tag, account) as
      | {
          kind: 'message'
          groupId: string
          sender: { account: string; deviceId: string }
          payload: string
        }
      | { kind: 'partial'; groupId: string; have: number; of: number }
      | { kind: 'own'; groupId: string }
    // Our own message from before this device kept a plaintext (or from a lost store): the
    // core cannot decrypt it again. Nothing is stored, so nothing changes.
    if (result.kind === 'own') return undefined
    const record: PlainRecord = {
      key,
      conversationId: meta.conversationId,
      groupId: result.groupId,
      account: result.kind === 'message' ? result.sender.account : account,
      device: result.kind === 'message' ? result.sender.deviceId : '',
      at: meta.at,
      messageId: meta.messageId,
    }
    if (result.kind === 'message') {
      const payload = JSON.parse(result.payload)
      record.payload = payload
      record.tokens = plainTokens(
        payload.t === 'msg' && typeof payload.text === 'string' ? payload.text : '',
      )
    } else record.hidden = true
    await persist([record])
    return record
  },

  envelopeClass: (tag: string) => envelopeClass(tag),

  /** Stored plaintexts by ciphertext key, for messages a tab is about to show. */
  async lookup(keys: string[]) {
    const tx = db!.transaction(PLAIN, 'readonly')
    const os = tx.objectStore(PLAIN)
    const found = await Promise.all(
      keys.map((k) => request(os.get(k)) as Promise<PlainRecord | undefined>),
    )
    return found.filter(Boolean) as PlainRecord[]
  },

  /** Every stored plaintext of one conversation, oldest first (edits and reactions need them). */
  async conversationPlain(conversationId: string) {
    const tx = db!.transaction(PLAIN, 'readonly')
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER])
    return request(
      tx.objectStore(PLAIN).index('conversation').getAll(range) as IDBRequest<PlainRecord[]>,
    )
  },

  /** Drops the plaintext of a message the server deleted. */
  async forgetMessage(messageId: string) {
    const tx = db!.transaction(PLAIN, 'readwrite')
    const index = tx.objectStore(PLAIN).index('message')
    const keys = await request(index.getAllKeys(messageId))
    for (const k of keys) tx.objectStore(PLAIN).delete(k)
    await done(tx)
  },

  /**
   * Local search over decrypted messages: every word must start a word of the message. Newest
   * first, at most `limit`.
   */
  async search(text: string, limit: number, conversationId?: string) {
    const words = plainTokens(text)
    if (!words.length) return []
    const tx = db!.transaction(PLAIN, 'readonly')
    const index = tx.objectStore(PLAIN).index('tokens')
    const [first, ...rest] = [...words].sort((a, b) => b.length - a.length)
    const candidates = (await request(
      index.getAll(IDBKeyRange.bound(first!, `${first}￿`)),
    )) as PlainRecord[]
    const seen = new Set<string>()
    return candidates
      .filter((r) => {
        if (seen.has(r.key) || r.hidden || (conversationId && r.conversationId !== conversationId))
          return false
        seen.add(r.key)
        return rest.every((w) => r.tokens?.some((t) => t.startsWith(w)))
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
  },

  conversations: () => getAll<ConversationRecord>(CONVERSATIONS),
  putConversation: (record: ConversationRecord) => putRecords(CONVERSATIONS, [record]),
  notices: () => getAll<NoticeRecord>(NOTICES),
  putNotice: (record: NoticeRecord) => putRecords(NOTICES, [record]),
  async deleteNotice(id: string) {
    const tx = db!.transaction(NOTICES, 'readwrite')
    tx.objectStore(NOTICES).delete(id)
    await done(tx)
  },

  /** Signing out: deletes this device's keys and its decrypted messages. */
  async wipe(account: string) {
    device?.free()
    device = undefined
    blob = null
    db?.close()
    db = undefined
    opened = ''
    await new Promise<void>((resolve, reject) => {
      const del = indexedDB.deleteDatabase(`${E2EE_DB_PREFIX}${account}`)
      del.onsuccess = () => resolve()
      del.onerror = () => reject(del.error)
      del.onblocked = () => resolve()
    })
  },
}

self.onmessage = ({ data }: MessageEvent<{ id: number; method: string; args: unknown[] }>) => {
  const run = async () => {
    ready ??= init({ module_or_path: wasmUrl }).then(() => {})
    await ready
    const method = methods[data.method]
    if (!method) throw Object.assign(new Error(`Unknown method ${data.method}`), { code: 'error' })
    try {
      const result = await (method as (...args: unknown[]) => unknown)(...data.args)
      await persist()
      return result
    } catch (error) {
      // A failed operation leaves the core's state as it was; anything it saved is still durable.
      await persist().catch(() => {})
      throw error
    }
  }
  queue = queue
    .catch(() => {})
    .then(run)
    .then(
      (result) => self.postMessage({ id: data.id, result }),
      (error) => self.postMessage({ id: data.id, error: errorShape(error) }),
    )
}
