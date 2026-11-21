<script setup vapor lang="ts">
import type { Message } from '../../../shared/types/chat'
/** Link content, file downloads, reactions and delivery state under a message. */
const props = defineProps<{ message: Message }>()
const emit = defineEmits<{ mediaReady: [url: string, ready: boolean] }>()
const chat = useChatStore()
const { t: $t, n: $n } = useI18n()
const reactionSupported = computed(() => chat.messageActionSupported(props.message, 'reactions'))
const reactionReason = computed(() => chat.messageActionReason(props.message, 'reactions'))
</script>
<template>
  <div class="message-extras pl-13.5 empty:hidden">
    <MessageLinks
      :message="message"
      @media-ready="(url, ready) => emit('mediaReady', url, ready)"
    />
    <MessageAttachments
      v-if="message.attachments?.length"
      :message="message"
      @media-ready="(url, ready) => emit('mediaReady', url, ready)"
    />
    <MessageAttachment
      v-else-if="message.attachment"
      :attachment="message.attachment"
      :message="message"
      @media-ready="(url, ready) => emit('mediaReady', url, ready)"
    />
    <div
      v-if="message.reactions.length"
      class="reactions flex gap-1 mt-1 flex-wrap"
    >
      <component
        :is="reactionSupported ? 'button' : 'span'"
        v-for="reaction in message.reactions"
        :key="reaction.emoji"
        class="reaction flex items-center gap-1.5 h-6.5 px-2.5 rounded-full text-[13px] bg-secondary/75 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border)_65%,transparent)] transition-colors hover:bg-accent hover:shadow-[inset_0_0_0_1px_var(--border)] disabled:opacity-100 [&_.inline-custom-emoji]:size-4.5 [&.is-reacted]:[background:linear-gradient(90deg,color-mix(in_srgb,var(--accent)_24%,var(--raised)),color-mix(in_srgb,var(--accent)_10%,var(--raised)))] [&.is-reacted]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_45%,transparent)] [&.is-reacted_.reaction-count]:text-primary [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]"
        :class="{ 'is-reacted': reaction.memberIds.includes('you') }"
        :aria-label="
          $t(
            'workspaceUi.message.reactionCount',
            { emoji: reaction.emoji, count: $n(reaction.memberIds.length) },
            reaction.memberIds.length,
          )
        "
        :aria-pressed="reactionSupported ? reaction.memberIds.includes('you') : undefined"
        :disabled="reactionSupported ? !!reactionReason : undefined"
        :title="
          reactionReason ?? reaction.memberIds.map((id) => chat.member(id)?.displayName).join(', ')
        "
        @click="reactionSupported && chat.react(message, reaction.emoji)"
      >
        <MessageContent :text="reaction.emoji" /><span
          class="reaction-count text-[12px] font-[600] text-muted-foreground tabular-nums"
          >{{ $n(reaction.memberIds.length) }}</span
        >
      </component>
    </div>
    <DeliveryActions
      v-if="message.delivery || message.unconfirmed"
      :message="message"
    />
  </div>
</template>
