import { pictureSrc } from '../../../shared/utils/instance-image'

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
  const desktop = !!usePlatform().serverOrigin
  const server = usePlatform().serverOrigin || config.instanceUrl
  const origin = (value: string, page: string) => {
    try {
      return new URL(value, page).origin
    } catch {
      return ''
    }
  }
  const origins = () => {
    if (typeof window === 'undefined') return []
    const page = window.location.origin
    const own = [config.apiBase, config.appApiBase, server]
      .filter((value): value is string => typeof value === 'string' && !!value)
      .map((value) => origin(value, page))
    // The desktop app's page is not on the instance, so relative addresses resolve against it.
    const first = desktop && server ? [origin(server, page)] : []
    return [...new Set([...first, page, ...own].filter(Boolean))]
  }
  return (value: string | null | undefined, raw?: string | null) =>
    typeof window === 'undefined'
      ? undefined
      : pictureSrc(value, raw, { origins: origins(), server: server || undefined, desktop })
}
