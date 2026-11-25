import type {
  AudioCaptureOptions,
  AudioProcessorOptions,
  LocalAudioTrack,
  Room,
  Track,
  TrackProcessor,
  TrackPublishOptions,
} from 'livekit-client'

export type NoiseSuppression = 'off' | 'standard' | 'enhanced'
export type MicrophoneFallback = 'noise' | 'gain'

export function voiceAudioPreset(bitrateKbps: number | undefined) {
  return { maxBitrate: (bitrateKbps || 48) * 1000 }
}

export interface MicrophoneSettings {
  noiseSuppression: NoiseSuppression
  echoCancellation: boolean
  autoGainControl: boolean
  gain: number
}

export const defaultMicrophoneSettings: Readonly<MicrophoneSettings> = {
  noiseSuppression: 'standard',
  echoCancellation: true,
  autoGainControl: true,
  gain: 100,
}

export function isNoiseSuppression(value: unknown): value is NoiseSuppression {
  return value === 'off' || value === 'standard' || value === 'enhanced'
}

export function normalizeVoiceLevel(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(200, Math.max(0, Math.round(value)))
    : 100
}

export function sanitizeMicrophoneSettings(value: unknown, previousNoiseSuppression: unknown) {
  const settings = value && typeof value === 'object' ? (value as Partial<MicrophoneSettings>) : {}
  return {
    noiseSuppression: isNoiseSuppression(settings.noiseSuppression)
      ? settings.noiseSuppression
      : isNoiseSuppression(previousNoiseSuppression)
        ? previousNoiseSuppression
        : defaultMicrophoneSettings.noiseSuppression,
    echoCancellation: settings.echoCancellation !== false,
    autoGainControl: settings.autoGainControl !== false,
    gain: normalizeVoiceLevel(settings.gain),
  } satisfies MicrophoneSettings
}

export function supportsEnhancedNoiseSuppression() {
  return (
    typeof AudioContext !== 'undefined' &&
    'audioWorklet' in AudioContext.prototype &&
    typeof AudioWorkletNode !== 'undefined' &&
    typeof WebAssembly !== 'undefined'
  )
}

export function microphoneCaptureOptions(
  deviceId: string,
  settings: MicrophoneSettings,
): AudioCaptureOptions {
  const standard = settings.noiseSuppression === 'standard'
  return {
    deviceId,
    channelCount: 1,
    echoCancellation: settings.echoCancellation,
    autoGainControl: settings.autoGainControl,
    noiseSuppression: standard,
    voiceIsolation: standard,
  }
}

export async function publishVoiceMicrophone(
  room: Room,
  deviceId: string,
  settings: MicrophoneSettings,
  signal: AbortSignal,
  onFallback: (effect: MicrophoneFallback) => void,
  options?: TrackPublishOptions,
) {
  const { LocalAudioTrack, Track } = await import('livekit-client')
  let track: LocalAudioTrack | undefined
  const stop = () => track?.stop()
  const reportFallback = (effect: MicrophoneFallback) => {
    if (!signal.aborted) onFallback(effect)
  }
  async function capture(mode: NoiseSuppression) {
    signal.throwIfAborted()
    const [microphone] = await room.localParticipant.createTracks({
      audio: microphoneCaptureOptions(deviceId, { ...settings, noiseSuppression: mode }),
    })
    if (!(microphone instanceof LocalAudioTrack)) {
      microphone?.stop()
      throw new Error('No local microphone track')
    }
    return microphone
  }

  signal.addEventListener('abort', stop, { once: true })
  try {
    const prefersEnhanced = settings.noiseSuppression === 'enhanced'
    const enhanced = prefersEnhanced && supportsEnhancedNoiseSuppression()
    const mode = prefersEnhanced && !enhanced ? 'standard' : settings.noiseSuppression
    if (prefersEnhanced && !enhanced) reportFallback('noise')
    track = await capture(mode)
    signal.throwIfAborted()
    if (enhanced || settings.gain !== 100) {
      const raw = track
      const standard = microphoneCaptureOptions(deviceId, {
        ...settings,
        noiseSuppression: 'standard',
      })
      const restoreStandard = () => {
        reportFallback('noise')
        if (!signal.aborted) void raw.applyConstraints(standard).catch(() => {})
      }
      let processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> | undefined
      try {
        const { createMicrophoneProcessor } = await import('./voice-microphone-processor')
        processor = await createMicrophoneProcessor(
          enhanced,
          settings.gain,
          signal,
          restoreStandard,
        )
        signal.throwIfAborted()
        await raw.setProcessor(processor)
      } catch {
        await processor?.destroy()
        signal.throwIfAborted()
        if (settings.gain !== 100) reportFallback('gain')
        if (enhanced) {
          raw.stop()
          reportFallback('noise')
          track = await capture('standard')
        }
      }
    }
    signal.throwIfAborted()
    await room.localParticipant.publishTrack(track, { ...options, source: Track.Source.Microphone })
    signal.throwIfAborted()
    return track
  } catch (error) {
    stop()
    throw error
  } finally {
    signal.removeEventListener('abort', stop)
  }
}
