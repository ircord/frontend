import type { H3Event } from 'h3'
import { createIRCordClient } from '../../shared/api/client'

const client = (event: H3Event) =>
  createIRCordClient(goApiBase(event), {
    headers: { cookie: getHeader(event, 'cookie') ?? '' },
    fetch: (request) =>
      fetch(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]) }),
  })

/**
 * What the production server entry (server/entry.bun.ts) shares with a request's handlers.
 * Development has no entry, so this is empty there.
 */
export interface EntryContext {
  peerAddress?: string
  /** The incoming request, whose body has not been read. */
  request?: Request
  /** A backend response for the entry to stream to the client instead of Nitro's buffered one. */
  upstream?: Response
}

export const entryContext = (event: H3Event): EntryContext =>
  (event.node.req as { __unenv__?: EntryContext }).__unenv__ ?? {}

/**
 * The address the request came from: from the production server entry (server/entry.bun.ts),
 * or from the socket when the server has one (development).
 */
export function peerAddress(event: H3Event) {
  const { peerAddress } = entryContext(event)
  if (typeof peerAddress === 'string' && peerAddress) return peerAddress
  return event.node.req.socket?.remoteAddress || undefined
}

/**
 * X-Forwarded-For for the backend: the inbound chain with this request's peer appended. The
 * backend reads it from the right and only believes entries added by its trusted proxies
 * (IRCORD_TRUSTED_PROXIES), so a client can't choose its own address. Without a known peer
 * it is empty, so the backend counts the frontend rather than a client-supplied entry.
 */
export function forwardedFor(event: H3Event) {
  const peer = peerAddress(event)
  if (!peer) return ''
  const inbound = getRequestHeaders(event)['x-forwarded-for']?.trim()
  return [inbound, peer].filter(Boolean).join(', ')
}

/** Resolve once per request; no account's cookie is retained outside that request. */
export function goApiBase(event: H3Event) {
  const config = useRuntimeConfig(event)
  if (config.demo) return ''
  const explicit = config.backendUrl as string
  if (explicit) return `${explicit.replace(/\/$/, '')}/api/v1`
  const base = config.public.apiBase
  return /^https?:\/\//.test(base) ? base.replace(/\/$/, '') : ''
}
export const backendPreferences = (event: H3Event) => client(event).appPreferences()
