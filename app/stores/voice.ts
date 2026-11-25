import { useEventListener } from '@vueuse/core'
import type { ConnectionQuality, RemoteParticipant, Room } from 'livekit-client'
import type { components } from '../../shared/generated/api'
import { apiClient, errorText } from '../utils/api'
import { readLocal, writeLocal } from '../utils/storage'
import { captureVoiceEcho, voiceSignalURL } from '../utils/voice-echo'
import {
  isNoiseSuppression,
  normalizeVoiceLevel,
  publishVoiceMicrophone,
  sanitizeMicrophoneSettings,
  supportsEnhancedNoiseSuppression,
  voiceAudioPreset,
  type MicrophoneFallback,
  type MicrophoneSettings,
} from '../utils/voice-microphone'

type VoiceRoom = components['schemas']['Room']
type VoiceState = 'idle' | 'joining' | 'connected' | 'reconnecting' | 'leaving'
const microphoneKey = 'ircord.voice.microphone'
const microphoneSettingsKey = 'ircord.voice.microphoneSettings'
const participantVolumesKey = (account: string) => `ircord.voice.participantVolumes.${account}`

interface VoiceParticipant {
  identity: string
  name: string
  local: boolean
}

export const useVoiceStore = defineStore('voice', () => {
  const chat = useChatStore()
  const auth = useAuthStore()
  const platform = usePlatform()
  const enabled = computed(
    () =>
      import.meta.client &&
      platform.kind !== 'tauri' &&
      auth.status === 'signed-in' &&
      chat.data?.capabilities.voice === true,
  )
  const rooms = useQuery({
    key: () => ['voice-rooms', auth.account?.id ?? ''],
    query: () => apiClient().listVoiceRooms(),
    enabled,
    staleTime: 10000,
  })
  const state = ref<VoiceState>('idle')
  const active = shallowRef<VoiceRoom>()
  const muted = ref(true)
  const deafened = ref(false)
  const changingMicrophone = ref(false)
  const needsAudio = ref(false)
  const connectionQuality = ref<ConnectionQuality>()
  const speakers = ref<string[]>([])
  const participants = ref<VoiceParticipant[]>([])
  const participantVolumes = shallowRef(new Map<string, number>())
  const maxParticipantVolume = ref(100)
  const microphones = shallowRef<MediaDeviceInfo[]>([])
  const microphone = ref(
    readLocal(microphoneKey, (value) => (typeof value === 'string' && value ? value : 'default')),
  )
  const microphoneSettings = shallowRef(
    readLocal(microphoneSettingsKey, (value) =>
      sanitizeMicrophoneSettings(
        value,
        readLocal('ircord.voice.noiseSuppression', (previous) => previous),
      ),
    ),
  )
  const enhancedNoiseSuppressionSupported = computed(supportsEnhancedNoiseSuppression)
  const microphoneFallbacks = ref<MicrophoneFallback[]>([])
  const canChangeMicrophoneSettings = computed(
    () =>
      !changingMicrophone.value &&
      echoState.value === 'idle' &&
      muted.value &&
      (state.value === 'idle' || state.value === 'connected'),
  )
  const error = ref('')
  const echoState = ref<'idle' | 'connecting' | 'recording'>('idle')
  const echoClip = ref('')
  const echoCaptureSettings = shallowRef<MediaTrackSettings>()
  const echoError = ref('')
  let echoController: AbortController | undefined
  let echoRoomID: string | undefined
  let client: Room | undefined
  let playbackContext: AudioContext | undefined
  let publishedMicrophoneSettings: MicrophoneSettings | undefined
  let callCancellation: AbortController | undefined
  let credentialID: string | undefined
  let attempt = 0
  const audio = new Set<HTMLMediaElement>()

  function reportMicrophoneFallback(effect: MicrophoneFallback) {
    if (!microphoneFallbacks.value.includes(effect)) microphoneFallbacks.value.push(effect)
  }

  function participantVolume(name: string) {
    return Math.min(maxParticipantVolume.value, participantVolumes.value.get(name) ?? 100)
  }

  function applyParticipantVolume(participant: RemoteParticipant) {
    const volume = participant.name ? participantVolume(participant.name) : 100
    participant.setVolume(deafened.value ? 0 : volume / 100)
  }

  function setParticipantVolume(identity: string, value: number) {
    const participant = client?.remoteParticipants.get(identity)
    const account = auth.account?.id
    if (!participant?.name || !account) return
    const level = Math.min(maxParticipantVolume.value, normalizeVoiceLevel(value))
    const next = new Map(participantVolumes.value)
    next.delete(participant.name)
    if (level !== 100) next.set(participant.name, level)
    const saved = [...next].slice(-200)
    participantVolumes.value = new Map(saved)
    applyParticipantVolume(participant)
    writeLocal(participantVolumesKey(account), saved)
  }

  function openPlaybackContext() {
    try {
      return new AudioContext()
    } catch {
      return undefined
    }
  }

  async function refreshDevices() {
    const devices = await navigator.mediaDevices?.enumerateDevices().catch(() => [])
    microphones.value =
      devices?.filter((device) => device.kind === 'audioinput' && device.label) ?? []
  }

  function release(id: string | undefined) {
    return id
      ? apiClient()
          .leaveVoiceRoom(id)
          .catch(() => {})
      : Promise.resolve()
  }

  async function disconnect() {
    if (state.value === 'idle' || state.value === 'leaving') return
    const leaving = ++attempt
    state.value = 'leaving'
    const previous = client
    const context = playbackContext
    const id = credentialID
    callCancellation?.abort()
    callCancellation = undefined
    client = undefined
    playbackContext = undefined
    publishedMicrophoneSettings = undefined
    credentialID = undefined
    active.value = undefined
    muted.value = true
    deafened.value = false
    needsAudio.value = false
    connectionQuality.value = undefined
    microphoneFallbacks.value = []
    speakers.value = []
    participants.value = []
    participantVolumes.value = new Map()
    for (const element of audio) {
      element.srcObject = null
      element.remove()
    }
    audio.clear()
    await Promise.all([previous?.disconnect(true).catch(() => {}), release(id)])
    await context?.close().catch(() => {})
    if (leaving === attempt) state.value = 'idle'
  }

  function leave() {
    error.value = ''
    cancelEcho()
    return disconnect()
  }

  function cancelEcho() {
    echoController?.abort()
    if (echoClip.value) URL.revokeObjectURL(echoClip.value)
    echoClip.value = ''
    echoCaptureSettings.value = undefined
    echoError.value = ''
  }

  async function testMicrophone(room: VoiceRoom) {
    if (
      !enabled.value ||
      state.value !== 'idle' ||
      echoState.value !== 'idle' ||
      changingMicrophone.value ||
      !room.available
    )
      return
    cancelEcho()
    microphoneFallbacks.value = []
    if (typeof MediaRecorder === 'undefined') {
      echoError.value = 'testUnsupported'
      return
    }
    const controller = new AbortController()
    echoController = controller
    echoRoomID = room.id
    echoState.value = 'connecting'
    const timeout = AbortSignal.timeout(25000)
    const signal = AbortSignal.any([controller.signal, timeout])
    let id: string | undefined
    try {
      const credential = await apiClient().joinVoiceRoom(room.id, true)
      id = credential.id
      signal.throwIfAborted()
      const recording = await captureVoiceEcho(
        credential,
        {
          deviceId: microphone.value,
          settings: microphoneSettings.value,
          bitrateKbps: room.bitrateKbps,
        },
        signal,
        () => {
          echoState.value = 'recording'
          void refreshDevices()
        },
        reportMicrophoneFallback,
      )
      signal.throwIfAborted()
      echoClip.value = URL.createObjectURL(recording.clip)
      echoCaptureSettings.value = recording.captureSettings
    } catch (problem) {
      if (!controller.signal.aborted)
        echoError.value = id || timeout.aborted ? 'testFailed' : errorText(problem)
    } finally {
      await release(id)
      echoController = undefined
      echoRoomID = undefined
      echoState.value = 'idle'
    }
  }

  async function join(room: VoiceRoom) {
    if (!enabled.value || state.value !== 'idle' || echoState.value !== 'idle' || !room.available)
      return
    cancelEcho()
    const joining = ++attempt
    error.value = ''
    microphoneFallbacks.value = []
    active.value = room
    state.value = 'joining'
    try {
      const sdk = await import('livekit-client')
      if (joining !== attempt) return
      // Leave browser networking diagnostics to the browser. SDK errors may include URLs.
      sdk.setLogLevel(sdk.LogLevel.silent)
      playbackContext = openPlaybackContext()
      maxParticipantVolume.value = playbackContext ? 200 : 100
      participantVolumes.value = readLocal(
        participantVolumesKey(auth.account?.id ?? ''),
        (value) => {
          const levels = new Map<string, number>()
          if (Array.isArray(value)) {
            for (const row of value.slice(-200)) {
              if (Array.isArray(row) && typeof row[0] === 'string') {
                levels.set(row[0], normalizeVoiceLevel(row[1]))
              }
            }
          }
          return levels
        },
      )
      const socket = new sdk.Room({
        webAudioMix: playbackContext ? { audioContext: playbackContext } : false,
        publishDefaults: {
          stopMicTrackOnMute: true,
          audioPreset: voiceAudioPreset(room.bitrateKbps),
        },
      })
      client = socket
      callCancellation = new AbortController()
      const current = () => joining === attempt && socket === client
      const updateParticipants = () => {
        if (!current()) return
        participants.value = [
          socket.localParticipant,
          ...socket.remoteParticipants.values(),
        ].flatMap((participant) =>
          participant.name
            ? [
                {
                  identity: participant.identity,
                  name: participant.name,
                  local: participant.isLocal,
                },
              ]
            : [],
        )
      }
      socket
        .on(sdk.RoomEvent.TrackSubscribed, (track, publication, participant) => {
          if (current() && track.kind === sdk.Track.Kind.Audio) {
            if (publication.source === sdk.Track.Source.Microphone)
              applyParticipantVolume(participant)
            const element = track.attach()
            element.hidden = true
            audio.add(element)
            document.body.append(element)
          }
        })
        .on(sdk.RoomEvent.TrackUnsubscribed, (track) => {
          for (const element of track.detach()) {
            audio.delete(element)
            element.remove()
          }
        })
        .on(sdk.RoomEvent.ParticipantConnected, updateParticipants)
        .on(sdk.RoomEvent.ParticipantDisconnected, updateParticipants)
        .on(sdk.RoomEvent.ActiveSpeakersChanged, (activeSpeakers) => {
          if (current()) speakers.value = activeSpeakers.map((speaker) => speaker.identity)
        })
        .on(sdk.RoomEvent.AudioPlaybackStatusChanged, (playing) => {
          if (current()) needsAudio.value = !playing
        })
        .on(sdk.RoomEvent.ConnectionQualityChanged, (quality, participant) => {
          if (current() && participant.isLocal) connectionQuality.value = quality
        })
        .on(sdk.RoomEvent.Reconnecting, () => {
          if (current()) state.value = 'reconnecting'
        })
        .on(sdk.RoomEvent.Reconnected, () => {
          if (current()) {
            state.value = 'connected'
            updateParticipants()
          }
        })
        .on(sdk.RoomEvent.Disconnected, () => {
          if (current() && state.value !== 'joining') {
            error.value = 'connectionEnded'
            void disconnect()
          }
        })
      const credential = await apiClient().joinVoiceRoom(room.id)
      if (!current()) {
        void release(credential.id)
        return
      }
      credentialID = credential.id
      await socket.connect(voiceSignalURL(credential.url), credential.token)
      if (!current()) {
        await socket.disconnect(true)
        return
      }
      state.value = 'connected'
      connectionQuality.value = socket.localParticipant.connectionQuality
      needsAudio.value = !socket.canPlaybackAudio
      updateParticipants()
      void refreshDevices()
    } catch (problem) {
      if (joining !== attempt) return
      // HTTP problem details are user-facing. Keep signaling and media errors generic.
      error.value = credentialID ? 'connectFailed' : errorText(problem)
      await disconnect()
    }
  }

  async function setMicrophone(next: string) {
    const socket = client
    if (
      changingMicrophone.value ||
      echoState.value !== 'idle' ||
      (state.value !== 'idle' && state.value !== 'connected')
    )
      return
    changingMicrophone.value = true
    error.value = ''
    try {
      // LiveKit defers device changes on a muted track until the user unmutes.
      if (socket && !(await socket.switchActiveDevice('audioinput', next, true)))
        throw new Error('Microphone unavailable')
      if (client === socket) {
        microphone.value = next
        writeLocal(microphoneKey, next)
      }
    } catch {
      error.value = 'microphoneFailed'
    } finally {
      changingMicrophone.value = false
    }
  }

  async function toggleMute() {
    const socket = client
    const signal = callCancellation?.signal
    if (
      !socket ||
      !signal ||
      deafened.value ||
      changingMicrophone.value ||
      state.value !== 'connected'
    )
      return
    changingMicrophone.value = true
    error.value = ''
    try {
      const { Track } = await import('livekit-client')
      signal.throwIfAborted()
      const participant = socket.localParticipant
      const settings = microphoneSettings.value
      const track = participant.getTrackPublication(Track.Source.Microphone)?.track
      if (muted.value && publishedMicrophoneSettings !== settings && track) {
        // Apply capture changes on the next unmute, without opening the microphone early.
        await participant.unpublishTrack(track, true)
      }
      signal.throwIfAborted()
      if (muted.value && !participant.getTrackPublication(Track.Source.Microphone)) {
        microphoneFallbacks.value = []
        await publishVoiceMicrophone(
          socket,
          microphone.value,
          settings,
          signal,
          reportMicrophoneFallback,
        )
        if (client === socket) publishedMicrophoneSettings = settings
      } else {
        await participant.setMicrophoneEnabled(muted.value)
      }
      if (client === socket) muted.value = !socket.localParticipant.isMicrophoneEnabled
      await refreshDevices()
    } catch {
      if (client === socket) error.value = 'microphoneFailed'
    } finally {
      changingMicrophone.value = false
    }
  }

  async function toggleDeafen() {
    const socket = client
    if (!socket || changingMicrophone.value || state.value !== 'connected') return
    const next = !deafened.value
    if (next && !muted.value) await toggleMute()
    if (client !== socket || state.value !== 'connected' || !muted.value) return
    deafened.value = next
    for (const participant of socket.remoteParticipants.values()) {
      applyParticipantVolume(participant)
    }
  }

  function updateMicrophoneSettings(patch: Partial<MicrophoneSettings>) {
    if (!canChangeMicrophoneSettings.value) return
    cancelEcho()
    microphoneSettings.value = sanitizeMicrophoneSettings(
      { ...microphoneSettings.value, ...patch },
      undefined,
    )
    microphoneFallbacks.value = []
    writeLocal(microphoneSettingsKey, microphoneSettings.value)
  }

  function setNoiseSuppression(mode: string) {
    if (
      !isNoiseSuppression(mode) ||
      (mode === 'enhanced' && !enhancedNoiseSuppressionSupported.value)
    )
      return
    updateMicrophoneSettings({ noiseSuppression: mode })
  }

  function enableAudio() {
    void client?.startAudio().catch(() => {
      error.value = 'playbackFailed'
    })
  }

  watch(rooms.data, (catalog) => {
    const id = active.value?.id ?? echoRoomID
    if (!catalog || !id) return
    const current = catalog.find((room) => room.id === id)
    if (!current) {
      if (active.value) error.value = 'connectionEnded'
      cancelEcho()
      void disconnect()
    } else if (active.value && active.value.name !== current.name) {
      active.value = { ...active.value, name: current.name }
    }
  })
  watch(enabled, (value) => {
    if (!value) void leave()
  })
  if (import.meta.client) {
    useEventListener(window, 'pagehide', leave)
    useEventListener(navigator.mediaDevices, 'devicechange', refreshDevices)
  }

  return {
    enabled,
    rooms,
    state,
    active,
    muted,
    deafened,
    changingMicrophone,
    needsAudio,
    connectionQuality,
    speakers,
    participants,
    maxParticipantVolume,
    participantVolume,
    setParticipantVolume,
    microphones,
    microphone,
    microphoneSettings,
    canChangeMicrophoneSettings,
    enhancedNoiseSuppressionSupported,
    microphoneFallbacks,
    error,
    echoState,
    echoClip,
    echoCaptureSettings,
    echoError,
    testMicrophone,
    cancelEcho,
    refreshDevices,
    join,
    leave,
    setMicrophone,
    setNoiseSuppression,
    updateMicrophoneSettings,
    toggleMute,
    toggleDeafen,
    enableAudio,
  }
})
