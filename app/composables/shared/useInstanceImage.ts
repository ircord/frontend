import { instanceImageUrl } from '../../../shared/utils/instance-image'
import { bundledDefaultAvatar, DEFAULT_AVATAR_PATH } from '../../../shared/utils/default-avatars'

/**
 * Returns a check that keeps a profile picture only when this IRCord instance serves it (#278).
 * The instance's origins are the page's and those of its configured API addresses.
 *
 * Pass the backend's same-origin `…Src` address first and the raw network `…Url` second. The
 * backend caches pictures from other instances and serves them from its own origin, so `…Src`
 * loads where the raw address would not. A default avatar from any instance maps to the bundled
 * copy, which needs no request.
 */
export function useInstanceImage() {
  const config = useRuntimeConfig().public
  const server = usePlatform().serverOrigin || config.instanceUrl
  const origins = () => {
    if (typeof window === 'undefined') return []
    const page = window.location.origin
    const own = [config.apiBase, config.appApiBase, server]
      .filter((value): value is string => typeof value === 'string' && !!value)
      .map((value) => {
        try {
          return new URL(value, page).origin
        } catch {
          return ''
        }
      })
    return [...new Set([page, ...own].filter(Boolean))]
  }
  const resolve = (value: string | null | undefined) => {
    const src = instanceImageUrl(value, origins())
    if (src && server && typeof window !== 'undefined') {
      const url = new URL(src, server)
      if (url.origin === server && url.pathname.startsWith(DEFAULT_AVATAR_PATH)) return url.pathname
      if (usePlatform().serverOrigin) return url.href
    }
    return src
  }
  return (value: string | null | undefined, raw?: string | null) => {
    const own = resolve(value)
    if (own) return own
    const bundled = bundledDefaultAvatar(raw)
    return bundled ? resolve(bundled) : resolve(raw)
  }
}
