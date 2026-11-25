<script setup lang="ts" vapor>
import { offlineStatus } from '../../utils/offline-archive'
defineProps<{ compact?: boolean }>()
const { t, n } = useI18n()
const $t = t
const chat = useChatStore()
const voice = useVoiceStore()
const actions = useWorkspaceActions()
const link = useClientLink()
const navigation = useConversationNavigation()
const label = computed(() => {
  if (chat.status === 'offline') return t('workspaceUi.sidebar.offline')
  if (chat.status === 'syncing') return t('workspaceUi.sidebar.syncing')
  if (chat.status !== 'connected')
    return t(
      chat.status === 'reconnecting'
        ? 'workspaceUi.sidebar.reconnecting'
        : 'workspaceUi.sidebar.connecting',
    )
  if (link.failing.value) return t('workspaceUi.sidebar.unstable')
  if (chat.network?.status === 'error') return t('workspaceUi.sidebar.ircFailed')
  if (chat.network?.status === 'connecting') return t('workspaceUi.sidebar.ircConnecting')
  if (chat.network?.status === 'disconnected') return t('workspaceUi.sidebar.ircDisconnected')
  return t('workspaceUi.sidebar.connected')
})
const healthy = computed(
  () => chat.status === 'connected' && chat.network?.status === 'connected' && !link.failing.value,
)
const latency = computed(() => {
  const sample = link.samples.value.at(-1)
  return chat.status === 'connected' &&
    !link.failing.value &&
    sample &&
    Date.now() - Date.parse(sample.at) < 75_000
    ? `${n(Math.round(sample.ms))} ms`
    : ''
})
const detail = computed(() =>
  [
    latency.value
      ? t('workspaceUi.sidebar.withLatency', { status: label.value, latency: latency.value })
      : label.value,
    offlineStatus.value.phase === 'syncing'
      ? t('workspaceUi.sidebar.savingOffline')
      : offlineStatus.value.phase === 'unavailable'
        ? t('workspaceUi.sidebar.offlineUnavailable')
        : t('workspaceUi.sidebar.offlineSaved', {
            messages: t(
              'workspaceUi.sidebar.offlineMessages',
              { count: n(offlineStatus.value.messages) },
              offlineStatus.value.messages,
            ),
            files: t(
              'workspaceUi.sidebar.offlineFiles',
              { count: n(offlineStatus.value.files) },
              offlineStatus.value.files,
            ),
          }),
    offlineStatus.value.error,
  ]
    .filter(Boolean)
    .join('\n'),
)
</script>
<template>
  <div
    class="sidebar-connection mb-2 shrink-0 overflow-hidden rounded-md bg-card/75 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border)_55%,transparent)]"
    :class="compact ? 'mx-1' : 'mx-2'"
  >
    <VoiceControls :compact="compact" />
    <p
      v-if="!compact && !voice.active && voice.error === 'connectionEnded'"
      role="status"
      class="border-b border-border/65 px-2.5 py-1.5 text-[length:var(--ui-caption)] text-muted-foreground"
    >
      {{ $t('workspaceUi.voice.connectionEnded') }}
    </p>
    <div
      v-if="!compact"
      class="flex min-h-9 items-center"
      :class="voice.active && 'border-t border-border/65'"
    >
      <AppTooltip
        :text="detail"
        side="top"
      >
        <button
          type="button"
          class="flex min-w-0 min-h-9 flex-1 items-center gap-2 rounded-md px-2.5 text-[length:var(--ui-caption)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:min-h-[44px]"
          :aria-label="$t('workspaceUi.sidebar.connectionDetails', { detail })"
          :disabled="!chat.networkId"
          @click="navigation.open(`server:${chat.networkId}`)"
        >
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="
              healthy
                ? 'bg-success'
                : chat.status === 'offline'
                  ? 'bg-muted-foreground'
                  : 'bg-warning'
            "
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 truncate text-left">{{ label }}</span>
          <span
            v-if="latency"
            class="rounded-full bg-secondary/65 px-2 py-0.5 text-[10px] font-medium tabular-nums shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border)_50%,transparent)]"
            >{{ latency }}</span
          >
          <AppIcon
            v-else-if="chat.status === 'offline'"
            name="offline"
            :size="12"
          />
        </button>
      </AppTooltip>
      <UiButton
        v-if="voice.enabled && !voice.active"
        variant="ghost"
        size="icon-sm"
        class="mr-1 shrink-0"
        :aria-label="$t('workspaceUi.voice.settings')"
        :title="$t('workspaceUi.voice.settings')"
        @click="actions.settings('voice-video')"
      >
        <AppIcon
          name="settings"
          :size="14"
          aria-hidden="true"
        />
      </UiButton>
    </div>
  </div>
</template>
