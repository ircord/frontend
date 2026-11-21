export const desktopCookie = 'ircord_desktop'

/** Admit only the native window and keep its local access cookie out of upstream requests. */
export function desktopRequestCookie(headers: Headers, local: URL, key: string) {
  const origin = headers.get('origin')
  const site = headers.get('sec-fetch-site')
  if (headers.get('host') !== local.host || (origin !== null && origin !== local.origin)) return
  if (site !== null && site !== 'same-origin' && site !== 'none') return

  const cookies = (headers.get('cookie') ?? '').split(';').map((value) => value.trim())
  const prefix = `${desktopCookie}=`
  if (!cookies.includes(prefix + key)) return
  return cookies.filter((value) => value && !value.startsWith(prefix)).join('; ')
}

/** The loopback server checks the local origin before forwarding to the hosted instance. */
export function desktopUpstreamOrigin(backend: string) {
  return process.env.IRCORD_DESKTOP_KEY ? new URL(backend).origin : undefined
}
