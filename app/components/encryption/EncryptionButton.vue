<script setup lang="ts" vapor>
/**
 * The conversation header's lock: open when the chat is not encrypted, closed when it is, with a
 * check once you verified the person, and a warning when something needs your attention. It opens
 * the encryption panel, where encryption starts, is verified and turned off. In an encrypted
 * group it counts the people you verified and opens the group's details.
 */
const { t } = useI18n()
const chat = useChatStore()
const e2ee = useE2eeStore()
const conversation = computed(() =>
  !chat.serverView &&
  !chat.active?.party &&
  (chat.active?.kind === 'direct' || e2ee.isGroupChannel(chat.active))
    ? chat.active
    : undefined,
)
const group = computed(() => e2ee.isGroupChannel(conversation.value))
const shown = computed(
  () =>
    e2ee.enabled &&
    !!conversation.value &&
    (group.value ||
      e2ee.isEncrypted(conversation.value.id) ||
      conversation.value.networkId === e2ee.homeNetwork?.id),
)
const record = computed(() =>
  conversation.value ? e2ee.conversations[conversation.value.id] : undefined,
)
const name = computed(() =>
  conversation.value
    ? (chat.directPartner(conversation.value)?.nick ?? conversation.value.name)
    : '',
)
const groupLock = computed(() =>
  conversation.value && group.value ? e2ee.groupLockFor(conversation.value.id) : undefined,
)
const state = computed(() => {
  if (groupLock.value) return record.value?.on ? groupLock.value.state : 'attention'
  const r = record.value
  if (!r?.on) return 'off'
  if (e2ee.notices.some((n) => n.account === r.peer) || !e2ee.ready) return 'attention'
  return e2ee.pins[r.peer]?.verified ? 'verified' : 'on'
})
const label = computed(() => {
  const lock = groupLock.value
  if (lock)
    return state.value === 'verified'
      ? t('encryption.group.lockVerified')
      : state.value === 'attention'
        ? t('encryption.group.lockAttention')
        : t('encryption.group.lockOn', { verified: lock.verified, total: lock.total })
  return t(`encryption.lock.${state.value}`, { name: name.value })
})
</script>
<template>
  <AppTooltip
    v-if="shown"
    :text="label"
  >
    <UiButton
      variant="ghost"
      size="icon-sm"
      class="encryption-lock relative shrink-0"
      :class="{
        'text-faint': state === 'off',
        'text-success': state === 'on' || state === 'verified',
        'text-warning': state === 'attention',
      }"
      :data-encryption-state="state"
      :aria-label="label"
      @click="conversation && (e2ee.panel = conversation.id)"
    >
      <AppIcon
        :name="state === 'off' ? 'lockOpen' : state === 'attention' ? 'shieldAlert' : 'lock'"
        :size="18"
      />
      <span
        v-if="state === 'verified'"
        class="absolute right-0.5 bottom-0.5 flex size-2.5 items-center justify-center rounded-full bg-success text-rail"
        aria-hidden="true"
        ><AppIcon
          name="check"
          :size="8"
      /></span>
    </UiButton>
  </AppTooltip>
</template>
