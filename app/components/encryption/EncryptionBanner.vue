<script setup lang="ts" vapor>
import { useQuery } from '@pinia/colada'
import { messagesQuery } from '../../queries/chat'
/**
 * What needs attention in the open encrypted conversation: the other person started fresh, a
 * message arrived unencrypted, or this device cannot read the chat yet.
 */
const { t } = useI18n()
const chat = useChatStore()
const e2ee = useE2eeStore()
const actions = useWorkspaceActions()
const record = computed(() => (chat.activeId ? e2ee.conversations[chat.activeId] : undefined))
const name = computed(() =>
  chat.active ? (chat.directPartner(chat.active)?.nick ?? record.value?.peer ?? '') : '',
)
const notice = computed(() =>
  record.value ? e2ee.notices.find((n) => n.account === record.value!.peer) : undefined,
)
const history = useQuery(() => messagesQuery(chat.activeId))
const plaintext = computed(
  () =>
    !!record.value?.on &&
    (history.data.value?.items ?? []).some(
      (m) => !m.encrypted && e2ee.present(m)?.e2ee?.state === 'plain',
    ),
)
const needsDevice = computed(() => !!record.value?.on && !e2ee.ready)
const busy = ref(false)
async function accept(verify: boolean) {
  if (!notice.value) return
  busy.value = true
  try {
    await e2ee.acceptReset(notice.value)
    if (verify) e2ee.panel = chat.activeId
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div
    v-if="notice || plaintext || needsDevice"
    class="encryption-banner grid gap-2 border-b border-border px-4 py-2.5 text-[13px]"
    data-encryption-banner
  >
    <div
      v-if="notice"
      class="flex gap-2.5"
      role="alert"
      data-encryption-reset
    >
      <AppIcon
        name="shieldAlert"
        :size="16"
        class="mt-0.5 shrink-0 text-warning"
      />
      <div class="grid gap-1.5">
        <strong>{{ t('encryption.reset.title', { name }) }}</strong>
        <p class="m-0 text-body">{{ t('encryption.reset.body', { name }) }}</p>
        <div class="flex flex-wrap gap-2">
          <UiButton
            size="sm"
            :disabled="busy"
            @click="accept(true)"
          >
            {{ t('encryption.reset.verify', { name }) }}
          </UiButton>
          <UiButton
            size="sm"
            variant="secondary"
            :disabled="busy"
            @click="accept(false)"
          >
            {{ t('encryption.reset.ok') }}
          </UiButton>
        </div>
      </div>
    </div>
    <p
      v-if="plaintext"
      class="m-0 flex items-center gap-2 text-destructive"
      role="status"
    >
      <AppIcon
        name="alert"
        :size="15"
      />{{ t('encryption.banner.plaintext') }}
    </p>
    <p
      v-if="needsDevice"
      class="m-0 flex flex-wrap items-center gap-2"
      role="status"
    >
      <AppIcon
        name="lock"
        :size="15"
        class="text-warning"
      />{{
        e2ee.phase === 'reset-elsewhere'
          ? t('encryption.banner.resetElsewhere')
          : t('encryption.banner.approve')
      }}
      <UiButton
        size="sm"
        variant="secondary"
        @click="actions.settings('encryption')"
      >
        {{ t('encryption.banner.approveAction') }}
      </UiButton>
    </p>
  </div>
</template>
