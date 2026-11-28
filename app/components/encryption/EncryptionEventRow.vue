<script setup lang="ts" vapor>
import type { Message } from '../../../shared/types/chat'
/** A signed control event: someone turned end-to-end encryption on or off in this chat. */
const props = defineProps<{ message: Message }>()
const { t } = useI18n()
const chat = useChatStore()
const e2ee = useE2eeStore()
const { time, full } = useTimeFormat()
const name = computed(() => {
  const c = chat.conversationSettings(props.message.conversationId)
  return (c && chat.directPartner(c)?.nick) || c?.name || ''
})
const on = computed(() => props.message.e2ee?.control === 'encryption-on')
const text = computed(() => {
  const byYou = props.message.e2ee?.controlBy === 'you'
  if (on.value)
    return byYou ? t('encryption.event.onYou') : t('encryption.event.onPeer', { name: name.value })
  return byYou ? t('encryption.event.offYou') : t('encryption.event.offPeer', { name: name.value })
})
</script>
<template>
  <div
    class="encryption-event flex flex-wrap items-center gap-2 py-1 pr-12 pl-7 text-[12px]"
    :class="on ? 'text-success' : 'text-warning'"
    data-encryption-event
  >
    <time
      class="shrink-0 text-[11px] text-faint tabular-nums"
      :datetime="message.createdAt"
      :title="full(message.createdAt)"
      >{{ time(message.createdAt) }}</time
    >
    <AppIcon
      :name="on ? 'lock' : 'lockOpen'"
      :size="12"
    />
    <span class="min-w-0 text-body">{{ text }}</span>
    <button
      v-if="on && message.e2ee?.controlBy === 'peer'"
      type="button"
      class="text-primary underline-offset-2 hover:underline"
      @click="e2ee.panel = message.conversationId"
    >
      {{ t('encryption.event.verify', { name }) }}
    </button>
  </div>
</template>
