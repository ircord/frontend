import { localSpeechShardUrl } from '../../../shared/local-speech'
import { goApiBase } from '../../utils/backend'

/**
 * Read-aloud's voice model on this device (#204). The engine and its small files are static files
 * under public/speech/, served before this route. Everything else under /speech/ lands here: a
 * weight shard named by the shipped manifests is redirected to Hugging Face at the pinned
 * revision; any other path is a 404, which the engine reads as "this export has no such model".
 * The worker and its cache use these same-origin model paths. Go resolves the redirects for
 * live installations. Demo uses the bundled revision.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const path = getRouterParam(event, 'path') ?? ''
  const config = useRuntimeConfig(event)
  const target =
    config.public.localSpeech !== false && ['GET', 'HEAD'].includes(event.method)
      ? localSpeechShardUrl(path)
      : ''
  if (!target) {
    setResponseStatus(event, 404)
    return { detail: 'Not Found' }
  }
  // The Hub's CDN refused some referrers; the browser sends none to it.
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  if (config.demo) return sendRedirect(event, target, 302)

  const backend = goApiBase(event)
  const reply = await fetch(`${backend}/app/speech/${path}`, {
    method: event.method,
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)
  const location = reply?.headers.get('Location')
  await reply?.body?.cancel()
  if (reply?.status === 302 && location === target) return sendRedirect(event, location, 302)
  throw createError({ statusCode: 502, statusMessage: 'The model shard is unavailable.' })
})
