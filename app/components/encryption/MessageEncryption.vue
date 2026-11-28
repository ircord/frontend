<script setup lang="ts" vapor>
import type { Message } from '../../../shared/types/chat'
import { decryptFile } from '../../../shared/e2ee/codec'
import type { Attachment } from '../../../shared/e2ee/types'
import { instanceFetch } from '../../utils/api'
/**
 * The encryption part of a message row: a placeholder while it decrypts or when this device
 * cannot read it, the "Not encrypted" mark for plaintext in an encrypted chat, and the message's
 * encrypted files, fetched and decrypted on this device.
 */
const props = defineProps<{ message: Message }>()
const { t } = useI18n()
const instanceOrigin = useInstanceOrigin()
const files = reactive<Record<string, { url?: string; failed?: boolean }>>({})
const fileKey = (a: Attachment) => `${a.url}#${a.sha256}`
const isImage = (a: Attachment) => /^image\/(png|jpeg|gif|webp|avif)$/.test(a.mime)

async function load(attachment: Attachment) {
  const key = fileKey(attachment)
  if (files[key]) return
  files[key] = {}
  try {
    // The URL comes from the other person: fetch only this server's own files.
    const url = new URL(attachment.url, instanceOrigin())
    if (url.origin !== new URL(instanceOrigin()).origin || !url.pathname.startsWith('/files/'))
      throw new Error('not an uploaded file')
    const response = await instanceFetch(url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(String(response.status))
    const plain = await decryptFile(await response.arrayBuffer(), attachment)
    // Only plain images keep their type; anything else is a download, never a page to open.
    const type = isImage(attachment) ? attachment.mime : 'application/octet-stream'
    files[key] = { url: URL.createObjectURL(new Blob([plain as BlobPart], { type })) }
  } catch {
    files[key] = { failed: true }
  }
}
watch(
  () => props.message.e2ee?.attachments,
  (list) => list?.forEach((a) => void load(a)),
  { immediate: true },
)
onBeforeUnmount(() => {
  for (const file of Object.values(files)) if (file.url) URL.revokeObjectURL(file.url)
})
</script>
<template>
  <div
    class="message-encryption grid gap-1.5"
    :data-e2ee-state="message.e2ee?.state"
  >
    <p
      v-if="message.e2ee?.state === 'pending'"
      class="m-0 flex items-center gap-1.5 text-[0.9em] text-faint italic"
    >
      <AppIcon
        name="lock"
        :size="12"
      />{{ t('encryption.message.pending') }}
    </p>
    <p
      v-else-if="message.e2ee?.state === 'failed'"
      class="m-0 flex items-center gap-1.5 text-[0.9em] text-muted-foreground italic"
    >
      <AppIcon
        name="lock"
        :size="12"
      />{{ message.e2ee.reason }}
    </p>
    <p
      v-else-if="message.e2ee?.state === 'plain'"
      class="m-0"
    >
      <span
        class="inline-flex items-center gap-1 rounded-[4px] bg-destructive px-1.5 py-px text-[11px] font-[650] text-destructive-foreground"
        :title="t('encryption.message.notEncryptedHelp')"
        data-not-encrypted
        ><AppIcon
          name="lockOpen"
          :size="11"
        />{{ t('encryption.message.notEncrypted') }}</span
      >
    </p>
    <div
      v-for="file in message.e2ee?.attachments ?? []"
      :key="fileKey(file)"
      class="encrypted-file"
    >
      <img
        v-if="isImage(file) && files[fileKey(file)]?.url"
        :src="files[fileKey(file)]!.url"
        :alt="file.name"
        :width="file.width"
        :height="file.height"
        class="max-h-80 max-w-full rounded-md object-contain"
        :style="
          file.width && file.height ? { aspectRatio: `${file.width} / ${file.height}` } : undefined
        "
      />
      <a
        v-else-if="files[fileKey(file)]?.url"
        :href="files[fileKey(file)]!.url"
        :download="file.name"
        class="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[13px] text-primary"
        ><AppIcon
          name="download"
          :size="14"
        />{{ t('encryption.message.download', { name: file.name }) }}</a
      >
      <p
        v-else
        class="m-0 flex items-center gap-1.5 text-[0.9em] text-muted-foreground italic"
      >
        <AppIcon
          name="file"
          :size="13"
        />{{
          files[fileKey(file)]?.failed
            ? t('encryption.message.fileFailed')
            : t('encryption.message.fileLoading')
        }}
        <span class="not-italic">{{ file.name }}</span>
      </p>
    </div>
  </div>
</template>
