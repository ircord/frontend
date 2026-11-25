import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import workletURL from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url&no-inline'
import wasmURL from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url&no-inline'
import simdURL from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url&no-inline'

export async function createRnnoiseFilter(context: AudioContext, signal: AbortSignal) {
  const [wasmBinary] = await Promise.all([
    loadRnnoise({ url: wasmURL, simdUrl: simdURL }, { signal }),
    context.audioWorklet.addModule(workletURL),
  ])
  signal.throwIfAborted()
  if (!WebAssembly.validate(wasmBinary)) throw new Error('Invalid RNNoise binary')
  const filter = new RnnoiseWorkletNode(context, { wasmBinary, maxChannels: 1 })
  filter.channelCount = 1
  filter.channelCountMode = 'explicit'
  return filter
}
