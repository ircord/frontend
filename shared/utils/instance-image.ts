import { bundledDefaultAvatar, DEFAULT_AVATAR_PATH } from './default-avatars'

/**
 * Profile pictures load only from this IRCord instance (#278). Anyone on IRC can set their avatar
 * to an address they control, and every viewer who loads it reveals their IP address and when
 * they are online. Pictures on another host show the person's initial instead.
 *
 * `origins` lists the instance's own origins: the page's, and the API's when it is served from
 * another host. A relative path resolves against the first origin. An image picked on this device
 * (a `data:` or `blob:` URL, as in the profile editor's preview) needs no request and loads too.
 */
export function instanceImageUrl(
  value: string | null | undefined,
  origins: readonly string[],
): string | undefined {
  if (!value) return undefined
  if (/^data:image\//i.test(value) || /^blob:/i.test(value)) return value
  if (!origins.length) return undefined
  try {
    const url = new URL(value, origins[0])
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (url.username || url.password) return undefined
    return origins.some((origin) => sameOrigin(origin, url.origin)) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Which address to draw for a profile picture. `src` is the backend's same-origin address (its
 * cached copy of a picture on another instance); `raw` is the address from the network.
 *
 * A default avatar maps to the bundled copy first, so it needs no request to the other instance.
 * Then `src`, then `raw`, each only when this instance serves it. `server` is the instance's
 * origin when it differs from the page's (the desktop app); relative addresses resolve against it
 * and are returned absolute, because the page itself is not on the instance.
 */
export function pictureSrc(
  src: string | null | undefined,
  raw: string | null | undefined,
  options: { origins: readonly string[]; server?: string; desktop?: boolean },
): string | undefined {
  const { origins, server, desktop } = options
  const resolve = (value: string | null | undefined) => {
    const own = instanceImageUrl(value, origins)
    if (own && server) {
      const url = new URL(own, server)
      if (url.origin === server && url.pathname.startsWith(DEFAULT_AVATAR_PATH)) return url.pathname
      if (desktop) return url.href
    }
    return own
  }
  const bundled = bundledDefaultAvatar(raw)
  if (bundled) return resolve(bundled)
  return resolve(src) ?? resolve(raw)
}

function sameOrigin(candidate: string, origin: string) {
  try {
    return new URL(candidate).origin === origin
  } catch {
    return false
  }
}
