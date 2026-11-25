<script setup vapor lang="ts">
import {
  HeadphoneOff,
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  Signal,
  SignalLow,
  Volume2,
} from '@lucide/vue'

defineProps<{ compact?: boolean }>()
const voice = useVoiceStore()
const actions = useWorkspaceActions()
const { t, n } = useI18n()
const status = computed(() => {
  if (voice.state === 'joining') return t('workspaceUi.voice.joining')
  if (voice.state === 'reconnecting') return t('workspaceUi.voice.reconnecting')
  if (voice.deafened) return t('workspaceUi.voice.deafened')
  return t('workspaceUi.voice.connected')
})
const quality = computed(() => voice.connectionQuality || 'unknown')
const qualityLabel = computed(() => t(`workspaceUi.voice.quality.${quality.value}`))
const bitrate = computed(() => n(voice.active?.bitrateKbps || 48))
const qualityDetail = computed(() =>
  t('workspaceUi.voice.qualityDetail', { quality: qualityLabel.value, bitrate: bitrate.value }),
)
const microphoneLabel = computed(() =>
  t(voice.muted ? 'workspaceUi.voice.unmute' : 'workspaceUi.voice.mute'),
)
const error = computed(() => {
  if (voice.error === 'microphoneFailed') return t('workspaceUi.voice.microphoneFailed')
  if (voice.error === 'playbackFailed') return t('workspaceUi.voice.playbackFailed')
  return ''
})
</script>

<template>
  <section
    v-if="voice.active"
    :aria-label="t('workspaceUi.voice.callControls')"
    class="grid gap-1.5 p-2"
  >
    <div
      v-if="!compact"
      class="flex min-w-0 items-center gap-2"
    >
      <Volume2
        :size="15"
        class="shrink-0"
        :class="voice.state === 'connected' ? 'text-success' : 'text-warning'"
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
        <p
          role="status"
          class="truncate text-[length:var(--ui-caption)] font-semibold"
        >
          {{ status }}
        </p>
        <p
          class="truncate text-[length:var(--ui-caption)] text-muted-foreground"
          :title="voice.active.name"
        >
          {{ voice.active.name }}
        </p>
      </div>
      <AppTooltip
        :text="qualityDetail"
        side="top"
      >
        <span
          class="inline-flex shrink-0 flex-col items-center gap-0.5 rounded-md px-1 py-0.5"
          :class="
            quality === 'poor' || quality === 'lost' ? 'text-warning' : 'text-muted-foreground'
          "
          :aria-label="qualityDetail"
          role="img"
        >
          <SignalLow
            v-if="quality === 'poor' || quality === 'lost'"
            :size="16"
            aria-hidden="true"
          />
          <Signal
            v-else
            :size="16"
            aria-hidden="true"
          />
          <span
            class="text-[10px] font-medium"
            aria-hidden="true"
            >{{ qualityLabel }}</span
          >
        </span>
      </AppTooltip>
    </div>
    <div
      v-else
      :aria-label="status + ', ' + qualityDetail"
      role="status"
      class="mx-auto text-success"
      :title="status + ', ' + qualityDetail"
    >
      <Volume2
        :size="15"
        aria-hidden="true"
      />
    </div>

    <div
      class="flex items-center gap-0.5"
      :class="compact ? 'flex-col' : 'justify-between'"
    >
      <UiButton
        :variant="voice.muted ? 'outline' : 'ghost'"
        size="icon-sm"
        :aria-label="microphoneLabel"
        :title="microphoneLabel"
        :disabled="voice.state !== 'connected' || voice.changingMicrophone || voice.deafened"
        @click="voice.toggleMute()"
      >
        <MicOff
          v-if="voice.muted"
          :size="15"
          aria-hidden="true"
        />
        <Mic
          v-else
          :size="15"
          aria-hidden="true"
        />
      </UiButton>
      <UiButton
        :variant="voice.deafened ? 'outline' : 'ghost'"
        size="icon-sm"
        :aria-label="t('workspaceUi.voice.deafen')"
        :aria-pressed="voice.deafened"
        :title="t(voice.deafened ? 'workspaceUi.voice.undeafen' : 'workspaceUi.voice.deafen')"
        :disabled="voice.state !== 'connected' || voice.changingMicrophone"
        @click="voice.toggleDeafen()"
      >
        <HeadphoneOff
          v-if="voice.deafened"
          :size="15"
          aria-hidden="true"
        />
        <Headphones
          v-else
          :size="15"
          aria-hidden="true"
        />
      </UiButton>
      <UiButton
        variant="ghost"
        size="icon-sm"
        :aria-label="t('workspaceUi.voice.settings')"
        :title="t('workspaceUi.voice.settings')"
        @click="actions.settings('voice-video')"
      >
        <AppIcon
          name="settings"
          :size="15"
          aria-hidden="true"
        />
      </UiButton>
      <UiButton
        variant="ghost"
        size="icon-sm"
        class="text-destructive"
        :aria-label="t('workspaceUi.voice.leave')"
        :title="t('workspaceUi.voice.leave')"
        @click="voice.leave()"
      >
        <PhoneOff
          :size="15"
          aria-hidden="true"
        />
      </UiButton>
    </div>
    <UiButton
      v-if="voice.needsAudio && !voice.deafened"
      variant="outline"
      :size="compact ? 'icon-sm' : 'sm'"
      :aria-label="t('workspaceUi.voice.enableSound')"
      :title="t('workspaceUi.voice.enableSound')"
      @click="voice.enableAudio()"
    >
      <Volume2
        v-if="compact"
        :size="15"
        aria-hidden="true"
      />
      <span v-else>{{ t('workspaceUi.voice.enableSound') }}</span>
    </UiButton>
    <p
      v-if="error"
      role="status"
      :class="compact ? 'sr-only' : 'text-xs text-destructive'"
    >
      {{ error }}
    </p>
    <p
      v-for="effect in voice.microphoneFallbacks"
      :key="effect"
      role="status"
      :class="compact ? 'sr-only' : 'text-xs text-muted-foreground'"
    >
      {{ t(`workspaceUi.voice.${effect}Fallback`) }}
    </p>
  </section>
</template>
