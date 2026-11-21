<script setup vapor lang="ts">
import type { Message } from '../../../shared/types/chat'
import { ircToMarkdown } from '../../../shared/utils/irc'

const props = defineProps<{ message: Message }>()
const chat = useChatStore()
const { t } = useI18n()
const { confirm } = usePrompt()
const working = ref(false)
const checking = ref(false)
const state = computed(
  () => props.message.delivery ?? (props.message.unconfirmed ? 'unconfirmed' : undefined),
)
const ambiguous = computed(() => state.value === 'uncertain' || state.value === 'unconfirmed')
const actionable = computed(
  () => !!props.message.delivery && (state.value === 'failed' || ambiguous.value),
)
const canRemove = computed(() => actionable.value || props.message.delivery === 'queued')
const movable = computed(
  () =>
    state.value === 'failed' &&
    !props.message.gif &&
    !props.message.replyTo &&
    !props.message.attachment &&
    !props.message.attachments?.length &&
    !props.message.deliveryHasAttachments,
)
const label = computed(() => {
  if (checking.value) return t('workspaceUi.message.checkingDelivery')
  switch (state.value) {
    case 'queued':
      return t('workspaceUi.message.queued')
    case 'pending':
      return t('workspaceUi.message.sending')
    case 'failed':
      return props.message.deliveryError || t('workspaceUi.message.notDelivered')
    case 'uncertain':
    case 'unconfirmed':
      return t('workspaceUi.message.deliveryNotConfirmed')
    default:
      return ''
  }
})

async function resend() {
  working.value = true
  try {
    const warn = ambiguous.value
    if (
      warn &&
      !(await confirm({
        title: t('workspaceUi.message.sendAgainTitle'),
        body: t('workspaceUi.message.sendAgainWarning'),
        confirm: t('workspaceUi.message.sendAgain'),
      }))
    )
      return
    await chat.retry(props.message, warn)
  } finally {
    working.value = false
  }
}

async function check() {
  working.value = true
  checking.value = true
  try {
    await chat.checkDelivery(props.message)
  } finally {
    checking.value = false
    working.value = false
  }
}

async function copy() {
  try {
    await usePlatform().copyText(ircToMarkdown(props.message.text))
    chat.notify(t('workspaceUi.message.outboxCopied'))
  } catch {
    chat.notify(t('workspaceUi.message.outboxCopyFailed'), { error: true })
  }
}

async function remove() {
  working.value = true
  try {
    if (
      await confirm({
        title: t('workspaceUi.message.removeOutboxTitle'),
        body: t('workspaceUi.message.removeOutboxBody'),
        confirm: t('workspaceUi.message.removeOutbox'),
        danger: true,
      })
    )
      await chat.discard(props.message)
  } finally {
    working.value = false
  }
}

async function moveToDraft() {
  working.value = true
  try {
    await chat.moveSendToDraft(props.message)
  } finally {
    working.value = false
  }
}
</script>

<template>
  <div
    v-if="state"
    class="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-[13px]"
  >
    <span
      role="status"
      :class="state === 'failed' ? 'text-destructive' : 'text-muted-foreground'"
    >
      {{ label }}
    </span>
    <template v-if="actionable">
      <UiButton
        v-if="ambiguous"
        variant="secondary"
        size="sm"
        class="[@media(pointer:coarse)]:min-h-11"
        :disabled="working"
        @click="check"
      >
        {{ t('workspaceUi.message.checkDelivery') }}
      </UiButton>
      <UiButton
        variant="secondary"
        size="sm"
        class="[@media(pointer:coarse)]:min-h-11"
        :disabled="working"
        @click="resend"
      >
        {{ t(ambiguous ? 'workspaceUi.message.sendAgain' : 'workspaceUi.message.retry') }}
      </UiButton>
      <UiButton
        v-if="movable"
        variant="ghost"
        size="sm"
        class="[@media(pointer:coarse)]:min-h-11"
        :disabled="working"
        @click="moveToDraft"
      >
        {{ t('workspaceUi.message.moveOutboxDraft') }}
      </UiButton>
    </template>
    <template v-if="canRemove">
      <UiButton
        variant="ghost"
        size="sm"
        class="[@media(pointer:coarse)]:min-h-11"
        :disabled="working"
        @click="copy"
      >
        {{ t('workspaceUi.message.outboxCopy') }}
      </UiButton>
      <UiButton
        variant="ghost"
        size="sm"
        class="[@media(pointer:coarse)]:min-h-11"
        :disabled="working"
        @click="remove"
      >
        {{ t('workspaceUi.message.removeOutbox') }}
      </UiButton>
    </template>
  </div>
</template>
