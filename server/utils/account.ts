import { getCookie, type H3Event } from 'h3'
import { backendPreferences } from './backend'
import { emptyLibrary, sanitizeLibrary, type PickerLibrary } from '../../shared/library'
import { sanitizeAppearance, type StoredAppearance } from '../../shared/appearance'
import { sanitizePreferences, type StoredPreferences } from '../../shared/preferences'
import {
  byteLength,
  emptyThemeLibrary,
  sanitizeThemeLibrary,
  themeLimits,
  type ThemeLibrary,
} from '../../shared/themes'
import { speechOrigin } from '../../shared/speech-service'

/** Demo fixtures resolve the account through the demo session. */
export async function accountId(event: H3Event) {
  return (await requireAccount(event)).id
}

// Nitro's `data` mount is durable on disk (.data/kv) in development and node deployments.
const storage = () => useStorage('data')
const key = (account: string, name: string) => `accounts:${account}:${name}`

export async function readAppearance(account: string): Promise<StoredAppearance> {
  const stored = await storage().getItem<StoredAppearance>(key(account, 'appearance'))
  return stored && typeof stored === 'object' && 'settings' in stored && stored.settings
    ? {
        settings: sanitizeAppearance(stored.settings),
        updatedAt:
          'updatedAt' in stored && typeof stored.updatedAt === 'string' ? stored.updatedAt : null,
      }
    : { settings: null, updatedAt: null }
}
export async function writeAppearance(account: string, settings: unknown) {
  const value = { settings: sanitizeAppearance(settings), updatedAt: new Date().toISOString() }
  await storage().setItem(key(account, 'appearance'), value)
  return value
}

export async function readLibrary(account: string): Promise<PickerLibrary> {
  const stored = await storage().getItem(key(account, 'library'))
  return stored ? sanitizeLibrary(stored) : emptyLibrary()
}

// Serialise read-modify-write per account so concurrent requests from two tabs do not drop edits.
const queues = new Map<string, Promise<unknown>>()
export function updateLibrary(account: string, change: (library: PickerLibrary) => void) {
  const previous = queues.get(account) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(async () => {
      const library = await readLibrary(account)
      change(library)
      const saved = sanitizeLibrary({ ...library, updatedAt: new Date().toISOString() })
      await storage().setItem(key(account, 'library'), saved)
      return saved
    })
  queues.set(account, next)
  void next.finally(() => queues.get(account) === next && queues.delete(account))
  return next
}

export async function readThemes(account: string): Promise<ThemeLibrary> {
  const stored = await storage().getItem(key(account, 'themes'))
  return stored ? sanitizeThemeLibrary(stored) : emptyThemeLibrary()
}

/**
 * Serialises theme changes per account in the demo store.
 * A refused change leaves the stored library intact.
 */
export function updateThemes(account: string, change: (library: ThemeLibrary) => void) {
  const next = (stored: unknown) => {
    const library = stored ? sanitizeThemeLibrary(stored) : emptyThemeLibrary()
    change(library)
    const saved = sanitizeThemeLibrary({ ...library, updatedAt: new Date().toISOString() })
    // Bytes, as the backend counts them, so the plain message wins over its generic 400.
    if (byteLength(JSON.stringify(saved)) > themeLimits.document)
      throw createError({
        statusCode: 413,
        statusMessage: 'Your themes are too large to save. Remove a theme or shorten its CSS.',
      })
    return saved
  }
  const queue = `${account}:themes`
  const previous = queues.get(queue) ?? Promise.resolve()
  const result = previous
    .catch(() => {})
    .then(async () => {
      const saved = next(await storage().getItem(key(account, 'themes')))
      await storage().setItem(key(account, 'themes'), saved)
      return saved
    })
  queues.set(queue, result)
  // A refused change rejects `result` for the caller; the cleanup must not reject again unheard.
  const cleanup = () => void (queues.get(queue) === result && queues.delete(queue))
  void result.then(cleanup, cleanup)
  return result
}

export function noStore(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
}

export async function readPreferences(account: string): Promise<StoredPreferences> {
  const stored = await storage().getItem<StoredPreferences>(key(account, 'preferences'))
  return stored && typeof stored === 'object' && 'preferences' in stored && stored.preferences
    ? {
        preferences: sanitizePreferences(stored.preferences),
        updatedAt:
          'updatedAt' in stored && typeof stored.updatedAt === 'string' ? stored.updatedAt : null,
      }
    : { preferences: null, updatedAt: null }
}
export async function writePreferences(account: string, preferences: unknown) {
  const value = {
    preferences: sanitizePreferences(preferences),
    updatedAt: new Date().toISOString(),
  }
  await storage().setItem(key(account, 'preferences'), value)
  return value
}

/**
 * The signed-in user's own read-aloud service origin, for their page's Content-Security-Policy;
 * '' for anyone signed out, without a service, or when it can't be read within a second. With the
 * Go service the preferences request carries the page request's cookie, so it is always that
 * user's document.
 */
export async function pageSpeechOrigin(event: H3Event) {
  if (!getCookie(event, 'ircord_session')) return ''
  const lookup = (async () => {
    const stored = useRuntimeConfig(event).demo
      ? await readPreferences(await accountId(event))
      : await backendPreferences(event)
    return speechOrigin(stored.preferences?.speech?.baseUrl ?? '')
  })().catch(() => '')
  // A slow backend never holds the page back: without an answer, the page simply has no origin
  // and read-aloud asks for a reload.
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<string>((resolve) => (timer = setTimeout(() => resolve(''), 1000)))
  try {
    return await Promise.race([lookup, timeout])
  } finally {
    clearTimeout(timer)
  }
}
