import type { E2eeErrorShape } from '../../shared/e2ee/types'

/** An error from the encryption worker, with the core's code (for example `identity-changed`). */
export class E2eeError extends Error {
  readonly code: string
  readonly account?: string
  readonly presented?: Uint8Array
  constructor(shape: E2eeErrorShape) {
    super(shape.message)
    this.name = 'E2eeError'
    this.code = shape.code
    this.account = shape.account
    this.presented = shape.presented
  }
}

type Pending = {
  method: string
  args: unknown[]
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

type ChannelMessage =
  | { type: 'leader'; tab: string }
  | { type: 'hello'; tab: string }
  | { type: 'call'; tab: string; id: number; method: string; args: unknown[] }
  | { type: 'reply'; to: string; id: number; result?: unknown; error?: E2eeErrorShape }
  | { type: 'changed'; tab: string; what: string }

/** The browser features one writer across tabs needs. */
export const e2eeSupported = () =>
  typeof window !== 'undefined' &&
  'locks' in navigator &&
  'BroadcastChannel' in window &&
  'indexedDB' in window &&
  'Worker' in window &&
  !!crypto.subtle

/**
 * One writer across tabs: the tab that holds the account's Web Lock runs the encryption worker,
 * and every other tab of the account sends its calls there over a BroadcastChannel. When that tab
 * closes, the lock passes to another tab, which starts the worker from the stored state and takes
 * over the calls still waiting for an answer.
 */
export class E2eeClient {
  private readonly tab = crypto.randomUUID()
  private readonly channel: BroadcastChannel
  private worker?: Worker
  private leader = false
  private leaderKnown = false
  private leaderTab = ''
  private release?: () => void
  private next = 1
  private readonly pending = new Map<number, Pending>()
  private readonly workerPending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >()
  private readonly changeListeners = new Set<(what: string) => void>()
  private stopped = false
  private readonly settings = new Map<string, unknown[]>()
  private readonly handled = new Map<string, Promise<unknown>>()

  constructor(readonly account: string) {
    this.channel = new BroadcastChannel(`ircord-e2ee:${account}`)
    this.channel.onmessage = ({ data }: MessageEvent<ChannelMessage>) => this.onChannel(data)
    void navigator.locks.request(`ircord-e2ee:${account}`, () => {
      if (this.stopped) return
      this.becomeLeader()
      return new Promise<void>((resolve) => (this.release = resolve))
    })
    this.channel.postMessage({ type: 'hello', tab: this.tab } satisfies ChannelMessage)
  }

  /** Runs a worker method in the tab that holds the lock. */
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (this.stopped)
      return Promise.reject(new E2eeError({ code: 'stopped', message: 'Signed out' }))
    return new Promise<T>((resolve, reject) => {
      const id = this.next++
      this.pending.set(id, { method, args, resolve: resolve as (v: unknown) => void, reject })
      this.dispatch(id)
    })
  }

  /** A call that configures the worker: run now, and again by any worker that takes over. */
  configure(method: string, ...args: unknown[]) {
    this.settings.set(method, args)
    return this.call(method, ...args)
  }

  /** Tells the other tabs that shared state changed (for example the list of encrypted chats). */
  announce(what: string) {
    this.channel.postMessage({ type: 'changed', tab: this.tab, what } satisfies ChannelMessage)
  }

  onChange(listener: (what: string) => void) {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  stop() {
    this.stopped = true
    for (const p of this.pending.values())
      p.reject(new E2eeError({ code: 'stopped', message: 'Signed out' }))
    this.pending.clear()
    this.worker?.terminate()
    this.worker = undefined
    this.release?.()
    this.channel.close()
  }

  private dispatch(id: number) {
    const p = this.pending.get(id)
    if (!p) return
    if (this.leader) {
      this.runLocal(p.method, p.args).then(
        (result) => {
          this.pending.delete(id)
          p.resolve(result)
        },
        (error) => {
          this.pending.delete(id)
          p.reject(error)
        },
      )
    } else if (this.leaderKnown) {
      this.channel.postMessage({
        type: 'call',
        tab: this.tab,
        id,
        method: p.method,
        args: p.args,
      } satisfies ChannelMessage)
    }
    // Otherwise the call waits until a leader announces itself, then goes out.
  }

  private runLocal(method: string, args: unknown[]) {
    return new Promise<unknown>((resolve, reject) => {
      const id = this.next++
      this.workerPending.set(id, { resolve, reject })
      this.worker!.postMessage({ id, method, args })
    })
  }

  private becomeLeader() {
    this.leader = true
    this.leaderKnown = true
    this.worker = new Worker(new URL('../workers/e2ee.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = ({ data }) => {
      const p = this.workerPending.get(data.id)
      if (!p) return
      this.workerPending.delete(data.id)
      if (data.error) p.reject(new E2eeError(data.error))
      else p.resolve(data.result)
    }
    this.worker.onerror = (event) => {
      for (const p of this.workerPending.values())
        p.reject(new E2eeError({ code: 'worker', message: event.message || 'Encryption stopped' }))
      this.workerPending.clear()
    }
    // A worker that takes over from a closed tab loads the stored state and the settings this
    // client gave the previous worker before any other call.
    void this.runLocal('open', [this.account]).catch(() => {})
    for (const [method, args] of this.settings) void this.runLocal(method, args).catch(() => {})
    this.channel.postMessage({ type: 'leader', tab: this.tab } satisfies ChannelMessage)
    // Calls this tab made while another tab led are run here now; an answer may have been lost.
    for (const id of this.pending.keys()) this.dispatch(id)
  }

  private onChannel(message: ChannelMessage) {
    if (this.stopped) return
    switch (message.type) {
      case 'hello':
        if (this.leader) this.channel.postMessage({ type: 'leader', tab: this.tab })
        break
      case 'leader':
        // Answers to other tabs' hellos repeat the same leader: only a new one gets the calls
        // again, or a call in progress there would run twice.
        if (message.tab === this.tab || message.tab === this.leaderTab) break
        this.leaderTab = message.tab
        this.leaderKnown = true
        for (const id of this.pending.keys()) this.dispatch(id)
        break
      case 'call': {
        if (!this.leader) break
        // A tab resends its waiting calls when it learns of a new leader; one this tab already
        // ran (or is running) is answered again, never run twice.
        const key = `${message.tab}:${message.id}`
        let run = this.handled.get(key)
        if (!run) {
          run = this.runLocal(message.method, message.args)
          this.handled.set(key, run)
          setTimeout(() => this.handled.delete(key), 120_000)
        }
        run.then(
          (result) =>
            this.channel.postMessage({ type: 'reply', to: message.tab, id: message.id, result }),
          (error: unknown) =>
            this.channel.postMessage({
              type: 'reply',
              to: message.tab,
              id: message.id,
              error:
                error instanceof E2eeError
                  ? {
                      code: error.code,
                      message: error.message,
                      account: error.account,
                      presented: error.presented,
                    }
                  : { code: 'error', message: String(error) },
            }),
        )
        break
      }
      case 'reply': {
        if (message.to !== this.tab) break
        const p = this.pending.get(message.id)
        if (!p) break
        this.pending.delete(message.id)
        if (message.error) p.reject(new E2eeError(message.error))
        else p.resolve(message.result)
        break
      }
      case 'changed':
        if (message.tab !== this.tab) for (const l of this.changeListeners) l(message.what)
        break
    }
  }
}
