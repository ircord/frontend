import { GoSocket, backendSocketURL, socketOrigin } from '../../../utils/go-socket'

export default defineWebSocketHandler({
  async upgrade(request) {
    const path = new URL(request.url).pathname
    const backend = backendSocketURL()
    if (!backend || (path !== '/voice/rtc' && path !== '/voice/rtc/v1'))
      throw new Response('Voice signaling unavailable', { status: 404 })
    const origin = request.headers.get('origin')
    if (origin !== socketOrigin(request.url))
      throw new Response('Origin not allowed', { status: 403 })
    const bridge = new GoSocket(backend, request, true)
    try {
      await bridge.ready
      const context = request.context ?? {}
      context.voiceSocket = bridge
      return { headers: undefined, context }
    } catch (error) {
      bridge.close()
      throw error
    }
  },
  open(peer) {
    if (peer.context.voiceSocket instanceof GoSocket) peer.context.voiceSocket.bind(peer)
  },
  message(peer, frame) {
    if (peer.context.voiceSocket instanceof GoSocket)
      peer.context.voiceSocket.send(frame.uint8Array())
  },
  close(peer) {
    if (peer.context.voiceSocket instanceof GoSocket) peer.context.voiceSocket.close()
  },
})
