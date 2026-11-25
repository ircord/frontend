import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LocalAudioTrack, Track, type Room } from 'livekit-client'
import {
  defaultMicrophoneSettings,
  microphoneCaptureOptions,
  publishVoiceMicrophone,
  sanitizeMicrophoneSettings,
  voiceAudioPreset,
} from './voice-microphone'

test('Voice rooms pass the selected bitrate to LiveKit in bits per second', () => {
  for (const rate of [128, 160, 192]) {
    assert.deepEqual(voiceAudioPreset(rate), { maxBitrate: rate * 1000 })
  }
  assert.deepEqual(voiceAudioPreset(undefined), { maxBitrate: 48_000 })
})

test('Enhanced capture replaces built-in noise suppression and keeps echo cancellation', () => {
  const standard = microphoneCaptureOptions('mic', defaultMicrophoneSettings)
  assert.deepEqual(standard, {
    deviceId: 'mic',
    channelCount: 1,
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: true,
    voiceIsolation: true,
  })
  assert.deepEqual(
    microphoneCaptureOptions('mic', { ...defaultMicrophoneSettings, noiseSuppression: 'enhanced' }),
    {
      ...standard,
      noiseSuppression: false,
      voiceIsolation: false,
    },
  )
})

test('Microphone preferences preserve independent controls and sanitize saved gain', () => {
  const settings = sanitizeMicrophoneSettings(
    { echoCancellation: false, autoGainControl: false, gain: 250 },
    'enhanced',
  )
  assert.deepEqual(settings, {
    noiseSuppression: 'enhanced',
    echoCancellation: false,
    autoGainControl: false,
    gain: 200,
  })
  assert.deepEqual(microphoneCaptureOptions('mic', { ...settings, noiseSuppression: 'off' }), {
    deviceId: 'mic',
    channelCount: 1,
    echoCancellation: false,
    autoGainControl: false,
    noiseSuppression: false,
    voiceIsolation: false,
  })
})

function microphoneFixture() {
  let stops = 0
  const track = Object.assign(Object.create(LocalAudioTrack.prototype) as LocalAudioTrack, {
    stop: () => {
      stops++
    },
  })
  const captured: unknown[] = []
  const published: unknown[] = []
  const room = {
    localParticipant: {
      async createTracks(options: unknown) {
        captured.push(options)
        return [track]
      },
      async publishTrack(_track: LocalAudioTrack, options: unknown) {
        published.push(options)
      },
    },
  } as unknown as Room
  return { track, room, captured, published, stops: () => stops }
}

test('Unsupported Enhanced capture falls back to Standard and publishes a microphone', async () => {
  const { room, track, captured, published, stops } = microphoneFixture()
  const controller = new AbortController()
  let fallbacks = 0
  const publishedTrack = await publishVoiceMicrophone(
    room,
    'mic',
    { ...defaultMicrophoneSettings, noiseSuppression: 'enhanced' },
    controller.signal,
    () => {
      fallbacks++
    },
    { dtx: false },
  )
  assert.equal(publishedTrack, track)
  assert.deepEqual(captured, [
    { audio: microphoneCaptureOptions('mic', defaultMicrophoneSettings) },
  ])
  assert.deepEqual(published, [{ source: Track.Source.Microphone, dtx: false }])
  assert.equal(fallbacks, 1)
  assert.equal(stops(), 0)
})

test('Capture that finishes after cancellation stops before publication', async () => {
  const { room, track, published, stops } = microphoneFixture()
  const controller = new AbortController()
  room.localParticipant.createTracks = async () => {
    controller.abort()
    return [track]
  }
  await assert.rejects(
    publishVoiceMicrophone(room, 'mic', defaultMicrophoneSettings, controller.signal, () => {}),
    { name: 'AbortError' },
  )
  assert.equal(stops(), 1)
  assert.deepEqual(published, [])
})
