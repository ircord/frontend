/* tslint:disable */
/* eslint-disable */

/** Where the page keeps one device's state blob. `save` receives a fresh
 * copy it may keep, and must replace the previous blob atomically. The blob
 * holds secret keys and the message ratchets: the write must be durable
 * before the page sends any line or commit that the same call returned, or a
 * restart can reuse spent keys and fork the group. With an asynchronous
 * store such as IndexedDB, keep `save` cheap (remember the blob) and await
 * the write before transmitting. */
export interface StateStore {
    load(): Uint8Array | null | undefined;
    save(state: Uint8Array): void;
}



/**
 * One device: its keys, trust store and groups.
 */
export class E2eeDevice {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Re-pins `account` after a reset. Returns the ids of the direct
     * messages it forgot, which a new group replaces.
     */
    acceptIdentityChange(account: string, identity_key: Uint8Array | number[]): Array<any>;
    addDevices(group_id: string, key_packages: Array<any>): any;
    certificateRequest(): Uint8Array;
    certifyDevice(request: Uint8Array | number[]): Uint8Array;
    confirmCommit(group_id: string): void;
    /**
     * The first device of an account: makes a new identity key.
     */
    static createAccount(store: StateStore, account: string): E2eeDevice;
    /**
     * A further device of an account, waiting for a certificate.
     */
    static createDevice(store: StateStore, account: string): E2eeDevice;
    discardCommit(group_id: string): void;
    /**
     * Encrypts plain text with a new message id. Returns `{ id, tags }`.
     */
    encryptText(group_id: string, text: string): any;
    /**
     * Encrypts a payload given as JSON. Returns the tag values, one per line.
     */
    encrypt(group_id: string, payload_json: string): Array<any>;
    epoch(group_id: string): number;
    /**
     * The state blob as last saved.
     */
    exportState(): Uint8Array;
    forgetGroup(group_id: string): void;
    /**
     * `[{ groupId, peer }]`.
     */
    groups(): Array<any>;
    installCertificate(certificate: Uint8Array | number[]): void;
    isActive(group_id: string): boolean;
    joinDm(welcome: Uint8Array | number[]): any;
    /**
     * `count` single-use key packages, as an array of `Uint8Array`.
     */
    keyPackages(count: number): Array<any>;
    lastResortKeyPackage(): Uint8Array;
    members(group_id: string): any;
    /**
     * Opens the device whose state `store.load()` returns.
     */
    static open(store: StateStore): E2eeDevice;
    /**
     * Pins a key from the key directory on first use. Returns `first-seen`,
     * `pinned` or `verified`; throws `identity-changed` on a mismatch.
     */
    pinIdentity(account: string, identity_key: Uint8Array | number[]): string;
    /**
     * `{ identityKey, verified }` for a pinned account, or `undefined`.
     */
    pin(account: string): any;
    processCommit(commit: Uint8Array | number[]): any;
    /**
     * Decrypts one `+ircord/e2ee` tag value. An `own` result is not
     * authenticated and must not change any state on the page. Returns
     * `{ kind: "message", groupId, sender, payload }` (payload as JSON text),
     * `{ kind: "partial", groupId, have, of }` or `{ kind: "own", groupId }`.
     */
    receive(tag_value: string, irc_account: string): any;
    /**
     * Removes devices given as `[{ account, deviceId }]`.
     */
    removeDevices(group_id: string, devices: Array<any>): any;
    /**
     * `{ digits, qr }` for verifying `peer`.
     */
    securityCode(peer: string): any;
    selfUpdate(group_id: string): any;
    setTagBudget(chars: number): void;
    setVerified(account: string, verified: boolean): void;
    startDm(peer: string, key_packages: Array<any>): any;
    readonly account: string;
    readonly certificate: Uint8Array | undefined;
    readonly deviceId: string;
    readonly deviceKey: Uint8Array;
    readonly holdsIdentity: boolean;
    readonly identityKey: Uint8Array | undefined;
}

/**
 * `m` or `a`: the class of a tag value, read without decrypting.
 */
export function envelopeClass(tag_value: string): string;

/**
 * A new random message id, for payloads the page builds itself.
 */
export function newMessageId(): string;

/**
 * The fixed `PRIVMSG` body sent with every envelope.
 */
export function placeholderBody(): string;

/**
 * The message tag's name, `+ircord/e2ee`.
 */
export function tagName(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_e2eedevice_free: (a: number, b: number) => void;
    readonly e2eedevice_acceptIdentityChange: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly e2eedevice_account: (a: number) => [number, number];
    readonly e2eedevice_addDevices: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly e2eedevice_certificate: (a: number) => [number, number];
    readonly e2eedevice_certificateRequest: (a: number) => [number, number, number, number];
    readonly e2eedevice_certifyDevice: (a: number, b: number, c: number) => [number, number, number, number];
    readonly e2eedevice_confirmCommit: (a: number, b: number, c: number) => [number, number];
    readonly e2eedevice_createAccount: (a: any, b: number, c: number) => [number, number, number];
    readonly e2eedevice_createDevice: (a: any, b: number, c: number) => [number, number, number];
    readonly e2eedevice_deviceId: (a: number) => [number, number];
    readonly e2eedevice_deviceKey: (a: number) => [number, number];
    readonly e2eedevice_discardCommit: (a: number, b: number, c: number) => [number, number];
    readonly e2eedevice_encrypt: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly e2eedevice_encryptText: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly e2eedevice_epoch: (a: number, b: number, c: number) => [number, number, number];
    readonly e2eedevice_exportState: (a: number) => [number, number];
    readonly e2eedevice_forgetGroup: (a: number, b: number, c: number) => [number, number];
    readonly e2eedevice_groups: (a: number) => any;
    readonly e2eedevice_holdsIdentity: (a: number) => number;
    readonly e2eedevice_identityKey: (a: number) => [number, number];
    readonly e2eedevice_installCertificate: (a: number, b: number, c: number) => [number, number];
    readonly e2eedevice_isActive: (a: number, b: number, c: number) => [number, number, number];
    readonly e2eedevice_joinDm: (a: number, b: number, c: number) => [number, number, number];
    readonly e2eedevice_keyPackages: (a: number, b: number) => [number, number, number];
    readonly e2eedevice_lastResortKeyPackage: (a: number) => [number, number, number, number];
    readonly e2eedevice_members: (a: number, b: number, c: number) => [number, number, number];
    readonly e2eedevice_open: (a: any) => [number, number, number];
    readonly e2eedevice_pin: (a: number, b: number, c: number) => any;
    readonly e2eedevice_pinIdentity: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly e2eedevice_processCommit: (a: number, b: number, c: number) => [number, number, number];
    readonly e2eedevice_receive: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly e2eedevice_removeDevices: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly e2eedevice_securityCode: (a: number, b: number, c: number) => [number, number, number];
    readonly e2eedevice_selfUpdate: (a: number, b: number, c: number) => [number, number, number];
    readonly e2eedevice_setTagBudget: (a: number, b: number) => [number, number];
    readonly e2eedevice_setVerified: (a: number, b: number, c: number, d: number) => [number, number];
    readonly e2eedevice_startDm: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly envelopeClass: (a: number, b: number) => [number, number, number, number];
    readonly newMessageId: () => [number, number, number, number];
    readonly placeholderBody: () => [number, number];
    readonly tagName: () => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
