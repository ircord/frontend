<script setup vapor lang="ts">
import type { Message } from '../../../shared/types/chat'
import { parseMessageLink } from '../../../shared/utils/message-links'
const props = defineProps<{ message: Message; urls: string[] }>()
const emit = defineEmits<{ mediaReady: [url: string, ready: boolean] }>()
const instanceOrigin = useInstanceOrigin()
/** Links to messages in this app show the message itself; they never unfurl as sites. */
const links = computed(() =>
  props.urls.map((url) => ({ url, message: parseMessageLink(url, instanceOrigin()) })),
)
</script>
<template>
  <div
    v-if="links.length"
    class="message-links grid gap-3 min-w-0"
  >
    <template
      v-for="link in links"
      :key="`${message.clientId ?? message.id}:${link.url}`"
    >
      <MessageLinkCard
        v-if="link.message"
        :link="link.message"
        :url="link.url"
      />
      <MessageLink
        v-else
        :message="message"
        :url="link.url"
        @media-ready="(url, ready) => emit('mediaReady', url, ready)"
      />
    </template>
  </div>
</template>
