import { $fetch } from '#build/fetch'
import { normalizeTransport, transportMemberId } from './transport'
import { createIRCordClient } from '../../shared/api/client'
import { sanitizeAppearance, type Appearance } from '../../shared/appearance'
import { sanitizePreferences, type ClientPreferences } from '../../shared/preferences'
import { skinTones, type PickerLibrary } from '../../shared/library'
import { sanitizeThemeLibrary, type Theme } from '../../shared/themes'
import type { EmojiCatalog, GifItem } from '../../shared/types/media'
let bases: { api: string; app: string; demo: boolean } | undefined

export function configureApiBases(config: { apiBase: string; appApiBase: string; demo: boolean }) {
  bases = { api: config.apiBase, app: config.appApiBase, demo: config.demo }
  client = undefined
}

// Read once inside the Nuxt context; later calls may come from timers and socket handlers.
function base() {
  if (!bases) {
    const config = useRuntimeConfig().public
    bases = { api: config.apiBase, app: config.appApiBase, demo: config.demo }
  }
  return bases
}

let client: ReturnType<typeof createIRCordClient> | undefined
/** The generated Go contract. Callers never assert their own response type. */
export function apiClient() {
  return (client ??= createIRCordClient(base().api, {
    transform: normalizeTransport,
    memberId: transportMemberId,
    onUnauthorized: () => window.dispatchEvent(new Event('ircord:session-expired')),
  }))
}

// Demo builds use their own account fixtures.
function appRequest<T extends object>(
  go: () => Promise<T>,
  path: string,
  method: 'GET' | 'PUT' | 'PATCH' | 'POST' | 'DELETE' = 'GET',
  body?: object,
): Promise<T> {
  const config = base()
  if (!config.demo) return go()
  return $fetch<object>(`${config.app}${path}`, {
    credentials: 'include',
    method,
    body,
  }) as Promise<T>
}

export const appClient = {
  async appearance() {
    const { settings, updatedAt } = await appRequest(
      () => apiClient().appAppearance(),
      '/appearance',
    )
    return { settings: settings ? sanitizeAppearance(settings) : null, updatedAt }
  },
  async saveAppearance(settings: Appearance) {
    const saved = await appRequest(
      () => apiClient().saveAppAppearance(settings),
      '/appearance',
      'PUT',
      { settings },
    )
    return {
      settings: saved.settings ? sanitizeAppearance(saved.settings) : null,
      updatedAt: saved.updatedAt,
    }
  },
  async preferences() {
    const saved = await appRequest(() => apiClient().appPreferences(), '/preferences')
    return {
      preferences: saved.preferences ? sanitizePreferences(saved.preferences) : null,
      updatedAt: saved.updatedAt,
    }
  },
  async savePreferences(preferences: ClientPreferences) {
    const saved = await appRequest(
      () => apiClient().saveAppPreferences(preferences),
      '/preferences',
      'PUT',
      { preferences },
    )
    return {
      preferences: saved.preferences ? sanitizePreferences(saved.preferences) : null,
      updatedAt: saved.updatedAt,
    }
  },
  library: () => appRequest<PickerLibrary>(() => apiClient().appLibrary(), '/library'),
  updateLibrary: (body: {
    uses?: Record<string, number>
    recent?: string[]
    skinTone?: string
  }) => {
    const skinTone = skinTones.find((tone) => tone === body.skinTone)
    return appRequest<PickerLibrary>(
      () => apiClient().updateAppLibrary({ ...body, skinTone }),
      '/library',
      'PATCH',
      body,
    )
  },
  saveGif: (body: GifItem) =>
    appRequest<PickerLibrary>(() => apiClient().saveAppGif(body), '/library/gifs', 'POST', body),
  removeGif: (id: string) =>
    appRequest<PickerLibrary>(
      () => apiClient().deleteAppGif(id),
      `/library/gifs/${encodeURIComponent(id)}`,
      'DELETE',
    ),
  emojiCatalog: () =>
    appRequest<EmojiCatalog>(() => apiClient().appEmojiCatalog(), '/emoji/catalog'),
  themes: async () =>
    sanitizeThemeLibrary(await appRequest(() => apiClient().appThemes(), '/themes')),
  /** `expected` is the version the edit started from. A concurrent edit returns 412. */
  async saveTheme(theme: Theme, expected: string | null, force = false) {
    const body = { theme, expected, force }
    return sanitizeThemeLibrary(
      await appRequest(
        () => apiClient().saveAppTheme(theme.id, body),
        `/themes/${encodeURIComponent(theme.id)}`,
        'PUT',
        body,
      ),
    )
  },
  deleteTheme: async (id: string) =>
    sanitizeThemeLibrary(
      await appRequest(
        () => apiClient().deleteAppTheme(id),
        `/themes/${encodeURIComponent(id)}`,
        'DELETE',
      ),
    ),
  setCustomCss: async (customCss: boolean) =>
    sanitizeThemeLibrary(
      await appRequest(() => apiClient().setAppThemeCss(customCss), '/themes', 'PATCH', {
        customCss,
      }),
    ),
}

/** HTTP status of a failed request, from either client. */
export const errorStatus = (error: unknown) =>
  (error as { status?: number; statusCode?: number } | null)?.status ??
  (error as { statusCode?: number } | null)?.statusCode

export const errorText = (error: unknown, translate?: (key: string) => string) => {
  const data = (error as { data?: { detail?: string; title?: string; statusMessage?: string } })
    ?.data
  return (
    data?.detail ??
    data?.statusMessage ??
    data?.title ??
    translate?.('workspaceUi.errors.serverUnavailable') ??
    'Couldn’t reach the server. Please try again.'
  )
}
