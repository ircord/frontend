import { instanceImageUrl } from '../../../shared/utils/instance-image'
import { DEFAULT_AVATAR_PATH } from '../../../shared/utils/default-avatars'

/**
 * Returns a check that keeps a profile picture only when this IRCord instance serves it (#278).
 * The instance's origins are the page's and those of its configured API addresses.
 */
export function useInstanceImage() {
  const config = useRuntimeConfig().public
  const origins = () => {
    if (typeof window === 'undefined') return []
    const page = window.location.origin
    const own = [config.apiBase, config.appApiBase, config.instanceUrl]
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
  return (value: string | null | undefined) => {
    const src = instanceImageUrl(value, origins())
    if (src && config.instanceUrl && typeof window !== 'undefined') {
      const url = new URL(src, window.location.origin)
      if (url.origin === config.instanceUrl && url.pathname.startsWith(DEFAULT_AVATAR_PATH))
        return url.pathname
    }
    return src
  }
}
