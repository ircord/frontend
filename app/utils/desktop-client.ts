export interface DesktopCore {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  Channel: new <T>(onmessage: (event: T) => void) => unknown
}

export interface RealtimeSocket {
  readonly readyState: number
  onmessage: ((event: MessageEvent<string>) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  send(data: string): void
  close(): void
}

interface NativeResponse {
  status: number
  headers: [string, string][]
  body: string
}

type SocketEvent =
  | { type: 'open' }
  | { type: 'message'; data: string }
  | { type: 'error' }
  | { type: 'close'; code: number; reason: string }

function base64(bytes: Uint8Array) {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)))
  return btoa(chunks.join(''))
}

export function createDesktopClient(core: DesktopCore, serverOrigin: string) {
  async function fetch(request: Request) {
    const url = new URL(request.url)
    if (url.origin !== serverOrigin) throw new TypeError('This request is for another server.')
    const { signal } = request
    signal.throwIfAborted()
    const body = request.body ? base64(new Uint8Array(await request.arrayBuffer())) : null
    signal.throwIfAborted()
    const id = crypto.randomUUID()
    let rejectAbort: (reason: unknown) => void
    const cancelled = new Promise<never>((_resolve, reject) => (rejectAbort = reject))
    const abort = () => {
      rejectAbort(signal.reason)
      void core.invoke('cancel_request', { id }).catch(() => {})
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      const result = await Promise.race([
        cancelled,
        core.invoke<NativeResponse>('api_request', {
          request: {
            id,
            method: request.method,
            path: url.pathname + url.search,
            headers: Array.from(request.headers.entries()),
            body,
            credentials: request.credentials !== 'omit',
          },
        }),
      ])
      const bytes = result.body
        ? Uint8Array.from(atob(result.body), (char) => char.charCodeAt(0))
        : null
      const response = new Response(bytes, { status: result.status, headers: result.headers })
      Object.defineProperty(response, 'url', { value: request.url })
      return response
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  function openSocket(url: URL): RealtimeSocket {
    const id = crypto.randomUUID()
    let state: number = WebSocket.CONNECTING
    const socket: RealtimeSocket = {
      get readyState() {
        return state
      },
      onmessage: null,
      onclose: null,
      onerror: null,
      send(data) {
        if (state !== WebSocket.OPEN)
          throw new DOMException('The event stream is closed.', 'InvalidStateError')
        void core.invoke('send_socket', { id, data }).catch(failed)
      },
      close() {
        if (state === WebSocket.CLOSED || state === WebSocket.CLOSING) return
        state = WebSocket.CLOSING
        void core.invoke('close_socket', { id }).catch(failed)
      },
    }
    function receive(event: SocketEvent) {
      if (state === WebSocket.CLOSED) return
      if (event.type === 'close') {
        state = WebSocket.CLOSED
        socket.onclose?.(new CloseEvent('close', { code: event.code, reason: event.reason }))
        return
      }
      if (state === WebSocket.CLOSING) return
      if (event.type === 'open') state = WebSocket.OPEN
      if (event.type === 'message')
        socket.onmessage?.(new MessageEvent('message', { data: event.data }))
      if (event.type === 'error') socket.onerror?.(new Event('error'))
    }
    function failed() {
      receive({ type: 'error' })
      receive({ type: 'close', code: 1006, reason: '' })
    }
    const events = new core.Channel<SocketEvent>(receive)
    void core.invoke('open_socket', { id, path: url.pathname + url.search, events }).then(() => {
      if (state === WebSocket.CLOSING) void core.invoke('close_socket', { id }).catch(failed)
    }, failed)
    return socket
  }
  return { fetch, openSocket }
}
