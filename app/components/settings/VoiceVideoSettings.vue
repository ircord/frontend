<script setup vapor lang="ts">
import { scopeLabels } from '../../../shared/settings-index'

const voice = useVoiceStore()
const { t, n } = useI18n()
const $t = t
const noiseSuppressionOptions = computed(() => [
  { value: 'off', label: t('settings.voiceVideo.noiseOff') },
  { value: 'standard', label: t('settings.voiceVideo.noiseStandard') },
  {
    value: 'enhanced',
    label: t('settings.voiceVideo.noiseEnhanced'),
    disabled: !voice.enhancedNoiseSuppressionSupported,
  },
])
const noiseSuppressionDescription = computed(() => {
  if (!voice.enhancedNoiseSuppressionSupported) return t('settings.voiceVideo.noiseUnsupported')
  if (!voice.muted) return t('settings.voiceVideo.noiseMuteToChange')
  return t('settings.voiceVideo.noiseHelp')
})
const testRoom = computed(() => voice.rooms.data?.find((room) => room.available))
const microphoneOptions = computed(() => {
  const devices = voice.microphones
    .filter((device) => device.deviceId !== 'default')
    .map((device) => ({ value: device.deviceId, label: device.label }))
  return [
    { value: 'default', label: t('workspaceUi.voice.defaultMicrophone') },
    ...devices,
    ...(voice.microphone !== 'default' &&
    !devices.some((device) => device.value === voice.microphone)
      ? [
          {
            value: voice.microphone,
            label: t('settings.voiceVideo.unavailableMicrophone'),
            disabled: true,
          },
        ]
      : []),
  ]
})
const testDescription = computed(() => {
  if (voice.state !== 'idle') return t('settings.voiceVideo.leaveToTest')
  if (voice.rooms.data?.length === 0) return t('settings.voiceVideo.joinToTest')
  if (!testRoom.value && !voice.rooms.isLoading) return t('workspaceUi.voice.unavailable')
  return t('settings.voiceVideo.testHelp')
})
const testError = computed(() => {
  if (voice.echoError === 'testUnsupported') return t('workspaceUi.voice.testUnsupported')
  if (voice.echoError === 'testFailed') return t('workspaceUi.voice.testFailed')
  return voice.echoError
})
const testNoiseMode = computed(() => {
  const mode = voice.microphoneFallbacks.includes('noise')
    ? 'standard'
    : voice.microphoneSettings.noiseSuppression
  return noiseSuppressionOptions.value.find((option) => option.value === mode)?.label
})
const testCaptureEcho = computed(() => {
  const state = voice.echoCaptureSettings?.echoCancellation
  if (state === undefined) return t('settings.voiceVideo.testEchoUnknown')
  return t(state ? 'settings.voiceVideo.testEchoOn' : 'settings.voiceVideo.testEchoOff')
})

onMounted(() => void voice.refreshDevices())
onBeforeUnmount(() => voice.cancelEcho())
</script>

<template>
  <SettingGroup
    :title="$t('settings.voiceVideo.audio')"
    :scope="$t(scopeLabels.device)"
  >
    <SettingRow
      data-setting="voice-microphone"
      :label="$t('workspaceUi.voice.microphone')"
      :description="
        $t(
          voice.microphones.length
            ? 'settings.voiceVideo.microphoneHelp'
            : 'settings.voiceVideo.microphoneDiscovery',
        )
      "
    >
      <AppSelect
        :model-value="voice.microphone"
        :options="microphoneOptions"
        :aria-label="$t('workspaceUi.voice.microphone')"
        :disabled="
          voice.changingMicrophone ||
          voice.echoState !== 'idle' ||
          (voice.state !== 'idle' && voice.state !== 'connected')
        "
        class="w-full max-w-64"
        @change="voice.setMicrophone"
      />
    </SettingRow>
    <p
      v-if="voice.error === 'microphoneFailed'"
      role="status"
      class="text-sm text-destructive"
    >
      {{ $t('workspaceUi.voice.microphoneFailed') }}
    </p>

    <SettingRow
      data-setting="voice-noise-suppression"
      :label="$t('settings.index.voice-noise-suppression.label')"
      :description="noiseSuppressionDescription"
    >
      <AppSegmented
        :label="$t('settings.index.voice-noise-suppression.label')"
        :model-value="voice.microphoneSettings.noiseSuppression"
        :options="noiseSuppressionOptions"
        :disabled="!voice.canChangeMicrophoneSettings"
        @change="voice.setNoiseSuppression"
      />
    </SettingRow>
    <SettingRow
      data-setting="voice-echo-cancellation"
      :label="$t('settings.index.voice-echo-cancellation.label')"
      :description="$t('settings.index.voice-echo-cancellation.description')"
    >
      <AppSwitch
        :model-value="voice.microphoneSettings.echoCancellation"
        :aria-label="$t('settings.index.voice-echo-cancellation.label')"
        :disabled="!voice.canChangeMicrophoneSettings"
        @change="voice.updateMicrophoneSettings({ echoCancellation: $event })"
      />
    </SettingRow>
    <SettingRow
      data-setting="voice-automatic-gain"
      :label="$t('settings.index.voice-automatic-gain.label')"
      :description="$t('settings.index.voice-automatic-gain.description')"
    >
      <AppSwitch
        :model-value="voice.microphoneSettings.autoGainControl"
        :aria-label="$t('settings.index.voice-automatic-gain.label')"
        :disabled="!voice.canChangeMicrophoneSettings"
        @change="voice.updateMicrophoneSettings({ autoGainControl: $event })"
      />
    </SettingRow>
    <SettingRow
      data-setting="voice-microphone-gain"
      :label="$t('settings.index.voice-microphone-gain.label')"
      :description="$t('settings.index.voice-microphone-gain.description')"
    >
      <div class="flex w-full max-w-48 items-center gap-3">
        <UiSlider
          :max="200"
          :label="$t('settings.index.voice-microphone-gain.label')"
          :model-value="[voice.microphoneSettings.gain]"
          :disabled="!voice.canChangeMicrophoneSettings"
          @update:model-value="voice.updateMicrophoneSettings({ gain: $event[0] })"
        />
        <output class="min-w-10 text-right text-xs text-muted-foreground tabular-nums">
          {{ n(voice.microphoneSettings.gain) }}%
        </output>
      </div>
    </SettingRow>
    <p
      v-for="effect in voice.microphoneFallbacks"
      :key="effect"
      role="status"
      class="text-sm text-muted-foreground"
    >
      {{ $t(`workspaceUi.voice.${effect}Fallback`) }}
    </p>

    <SettingRow
      data-setting="voice-microphone-test"
      :label="$t('workspaceUi.voice.testMicrophone')"
      :description="testDescription"
    >
      <UiButton
        v-if="voice.echoState === 'idle'"
        variant="outline"
        size="sm"
        :disabled="voice.state !== 'idle' || voice.changingMicrophone || !testRoom"
        @click="testRoom && voice.testMicrophone(testRoom)"
      >
        {{ $t('settings.voiceVideo.startTest') }}
      </UiButton>
      <UiButton
        v-else
        variant="ghost"
        size="sm"
        @click="voice.cancelEcho()"
      >
        {{ $t('workspaceUi.voice.cancelTest') }}
      </UiButton>
    </SettingRow>
    <p
      v-if="voice.echoState !== 'idle'"
      role="status"
      class="text-sm text-muted-foreground"
    >
      {{
        $t(
          voice.echoState === 'connecting'
            ? 'workspaceUi.voice.testConnecting'
            : 'workspaceUi.voice.testRecording',
        )
      }}
    </p>
    <audio
      v-if="voice.echoClip"
      :src="voice.echoClip"
      :aria-label="$t('workspaceUi.voice.testPlayback')"
      class="h-9 w-full min-w-0 max-w-sm"
      controls
      autoplay
    />
    <p
      v-if="voice.echoClip"
      class="text-xs text-muted-foreground"
    >
      {{ $t('settings.voiceVideo.testProcessing', { mode: testNoiseMode }) }}
      {{ testCaptureEcho }}
    </p>
    <p
      v-if="testError"
      role="status"
      class="text-sm text-destructive"
    >
      {{ testError }}
    </p>
  </SettingGroup>
</template>
