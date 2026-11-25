import type { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'

class MicrophoneProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'ircord-microphone'
  processedTrack?: MediaStreamTrack
  private readonly gain: GainNode
  private readonly output: MediaStreamAudioDestinationNode
  private source?: MediaStreamAudioSourceNode
  private closed = false

  constructor(
    private readonly context: AudioContext,
    gain: number,
    private filter: RnnoiseWorkletNode | undefined,
    onFilterFailure: () => void,
  ) {
    this.output = context.createMediaStreamDestination()
    this.output.channelCount = 1
    this.gain = context.createGain()
    this.gain.gain.value = gain / 100
    if (gain > 100) {
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -3
      limiter.knee.value = 0
      limiter.ratio.value = 20
      limiter.attack.value = 0.003
      limiter.release.value = 0.08
      this.gain.connect(limiter).connect(this.output)
    } else {
      this.gain.connect(this.output)
    }
    this.processedTrack = this.output.stream.getAudioTracks()[0]
    if (!filter) return
    filter.connect(this.gain)
    filter.addEventListener(
      'processorerror',
      () => {
        if (this.closed) return
        // Bypass a failed worklet while retaining gain and the published track.
        filter.disconnect()
        filter.destroy()
        this.filter = undefined
        this.source?.disconnect()
        this.source?.connect(this.gain)
        onFilterFailure()
      },
      { once: true },
    )
  }

  async init({ track }: AudioProcessorOptions) {
    this.source?.disconnect()
    this.source = this.context.createMediaStreamSource(new MediaStream([track]))
    this.source.connect(this.filter ?? this.gain)
  }

  async restart(options: AudioProcessorOptions) {
    // LiveKit replaces the capture track when unmuting or switching devices.
    await this.init(options)
  }

  async destroy() {
    if (this.closed) return
    this.closed = true
    this.source?.disconnect()
    this.filter?.disconnect()
    this.filter?.destroy()
    this.gain.disconnect()
    this.processedTrack?.stop()
    this.processedTrack = undefined
    await this.context.close().catch(() => {})
  }
}

export async function createMicrophoneProcessor(
  enhanced: boolean,
  gain: number,
  cancel: AbortSignal,
  onFilterFailure: () => void,
) {
  cancel.throwIfAborted()
  // RNNoise expects 48 kHz mono audio. Web Audio resamples the capture device to this rate.
  const context = new AudioContext(enhanced ? { sampleRate: 48000 } : undefined)
  const signal = AbortSignal.any([cancel, AbortSignal.timeout(5000)])
  const aborted = Promise.withResolvers<never>()
  const onAbort = () => aborted.reject(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const filter = enhanced
      ? import('./voice-rnnoise').then((module) => module.createRnnoiseFilter(context, signal))
      : undefined
    const [node] = await Promise.race([Promise.all([filter, context.resume()]), aborted.promise])
    return new MicrophoneProcessor(context, gain, node, onFilterFailure)
  } catch (error) {
    await context.close().catch(() => {})
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
