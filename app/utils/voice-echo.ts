import type { LocalAudioTrack } from 'livekit-client'
import {
  publishVoiceMicrophone,
  voiceAudioPreset,
  type MicrophoneFallback,
  type MicrophoneSettings,
} from './voice-microphone'

export function voiceSignalURL(value: string) {
  const expected = new URL(window.location.origin)
  expected.protocol = expected.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(value)
  if (
    url.origin !== expected.origin ||
    url.pathname !== '/voice' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid voice server')
  }
  return url.href
}

async function recordAudio(track: MediaStreamTrack, signal: AbortSignal, onRecording: () => void) {
  signal.throwIfAborted()
  const stream = new MediaStream([track])
  // Some browsers need a playing media element to decode incoming WebRTC audio.
  const decoder = new Audio()
  decoder.muted = true
  decoder.srcObject = stream
  const stopDecoder = () => {
    decoder.pause()
    decoder.srcObject = null
  }
  signal.addEventListener('abort', stopDecoder, { once: true })
  try {
    await decoder.play()
    signal.throwIfAborted()
    return await recordStream(stream, signal, onRecording)
  } finally {
    signal.removeEventListener('abort', stopDecoder)
    stopDecoder()
  }
}

function recordStream(stream: MediaStream, signal: AbortSignal, onRecording: () => void) {
  const recorder = new MediaRecorder(stream)
  return new Promise<Blob>((resolve, reject) => {
    const chunks: Blob[] = []
    const stop = () => {
      if (recorder.state !== 'inactive') recorder.stop()
    }
    recorder.ondataavailable = ({ data }) => {
      if (data.size) chunks.push(data)
    }
    recorder.start()
    const timer = window.setTimeout(stop, 4000)
    signal.addEventListener('abort', stop, { once: true })
    const cleanup = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', stop)
    }
    recorder.onerror = (event) => {
      cleanup()
      reject(event)
    }
    recorder.onstop = () => {
      cleanup()
      if (signal.aborted) reject(signal.reason)
      else if (!chunks.length) reject(new Error('No audio received'))
      else resolve(new Blob(chunks, { type: recorder.mimeType || chunks[0]!.type }))
    }
    onRecording()
  })
}

export async function captureVoiceEcho(
  credential: { url: string; token: string; playbackToken?: string },
  {
    deviceId,
    settings,
    bitrateKbps,
  }: { deviceId: string; settings: MicrophoneSettings; bitrateKbps?: number },
  cancel: AbortSignal,
  onRecording: () => void,
  onFallback: (effect: MicrophoneFallback) => void,
) {
  const sdk = await import('livekit-client')
  cancel.throwIfAborted()
  if (!credential.playbackToken) throw new Error('Missing private playback credential')
  const endpoint = voiceSignalURL(credential.url)
  const sender = new sdk.Room({ publishDefaults: { audioPreset: voiceAudioPreset(bitrateKbps) } })
  const receiver = new sdk.Room()
  let microphone: LocalAudioTrack | undefined
  const disconnected = new AbortController()
  const signal = AbortSignal.any([cancel, disconnected.signal])
  const failed = () => disconnected.abort(new Error('Microphone test disconnected'))
  sender.on(sdk.RoomEvent.Disconnected, failed)
  receiver.on(sdk.RoomEvent.Disconnected, failed)
  const abort = Promise.withResolvers<never>()
  const failOnAbort = () => abort.reject(signal.reason)
  signal.addEventListener('abort', failOnAbort, { once: true })
  sdk.setLogLevel(sdk.LogLevel.silent)

  async function capture(playbackToken: string) {
    await Promise.all([
      receiver.connect(endpoint, playbackToken),
      sender.connect(endpoint, credential.token),
    ])
    signal.throwIfAborted()
    const received = new Promise<MediaStreamTrack>((resolve) => {
      receiver.on(sdk.RoomEvent.TrackSubscribed, (remote) => {
        if (remote.kind === sdk.Track.Kind.Audio) resolve(remote.mediaStreamTrack)
      })
    })
    microphone = await publishVoiceMicrophone(sender, deviceId, settings, signal, onFallback, {
      dtx: false,
    })
    if (signal.aborted) {
      microphone.stop()
      signal.throwIfAborted()
    }
    const clip = await recordAudio(await received, signal, onRecording)
    const captureSettings = microphone.getSourceTrackSettings()
    return { clip, captureSettings }
  }

  try {
    return await Promise.race([capture(credential.playbackToken), abort.promise])
  } finally {
    microphone?.stop()
    signal.removeEventListener('abort', failOnAbort)
    sender.off(sdk.RoomEvent.Disconnected, failed)
    receiver.off(sdk.RoomEvent.Disconnected, failed)
    await Promise.all([
      sender.disconnect(true).catch(() => {}),
      receiver.disconnect(true).catch(() => {}),
    ])
  }
}
