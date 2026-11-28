<script setup lang="ts" vapor>
import type { Message } from '../../../shared/types/chat'
import { sameAccount } from '../../../shared/e2ee/group'
/**
 * A signed control event: someone turned end-to-end encryption on or off in this chat, or left an
 * encrypted group. Also a line of a group's timeline from a commit, such as "Peter added Alex".
 */
const props = defineProps<{ message: Message }>()
const { t } = useI18n()
const chat = useChatStore()
const e2ee = useE2eeStore()
const { time, full } = useTimeFormat()
const name = computed(() => {
  const c = chat.conversationSettings(props.message.conversationId)
  return (c && chat.directPartner(c)?.nick) || c?.name || ''
})
/** A person as this channel names them: "You", their nick here, or their account. */
function person(account: string | undefined) {
  if (!account) return ''
  if (sameAccount(account, e2ee.account)) return t('encryption.group.you')
  const id = e2ee.memberIdFor(props.message.conversationId, account)
  return (id && chat.member(id)?.nick) || account
}
const event = computed(() => props.message.e2ee?.groupEvent)
const on = computed(
  () =>
    props.message.e2ee?.control === 'encryption-on' ||
    (!!event.value &&
      !['removed', 'left', 'removed-you', 'device-removed'].includes(event.value.kind)),
)
const text = computed(() => {
  const e = event.value
  if (e) {
    const values = {
      by: person(e.by),
      subject: e.kind === 'title' || e.kind === 'created' ? e.subject : person(e.subject),
    }
    if (e.kind === 'added' && sameAccount(e.subject, e2ee.account))
      return t('encryption.group.event.addedYou', values)
    return t(`encryption.group.event.${e.kind}`, values)
  }
  const control = props.message.e2ee?.control
  const byYou = props.message.e2ee?.controlBy === 'you'
  if (control === 'left')
    return byYou
      ? t('encryption.group.event.leftYou')
      : t('encryption.group.event.left', { by: person(props.message.e2ee?.controlAccount) })
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
      :name="event ? 'users' : on ? 'lock' : 'lockOpen'"
      :size="12"
    />
    <span class="min-w-0 text-body">{{ text }}</span>
    <button
      v-if="!event && on && message.e2ee?.controlBy === 'peer'"
      type="button"
      class="text-primary underline-offset-2 hover:underline"
      @click="e2ee.panel = message.conversationId"
    >
      {{ t('encryption.event.verify', { name }) }}
    </button>
  </div>
</template>
