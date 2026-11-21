<script setup vapor lang="ts">
import type { Message } from '../../../shared/types/chat'
import { ircToMarkdown } from '../../../shared/utils/irc'

/** Discord-style inline editing of one of your messages: Enter saves, Escape cancels. */
const props = defineProps<{ message: Message }>()
const chat = useChatStore()
const { t } = useI18n()
const $t = t
const editing = useMessageEditing()
const actions = useWorkspaceActions()
const draft = ref(ircToMarkdown(props.message.text))
/** Server emoji show as images, as in the message box; the text stays `:name:`. */
const input = ref<HTMLElement | null>(null)
useEmojiField(input, draft, 4000)
const saving = ref(false)

onMounted(() => {
  const el = input.value as HTMLTextAreaElement | null
  if (!el) return
  el.focus()
  el.setSelectionRange(draft.value.length, draft.value.length)
})
function cancel() {
  editing.stop()
  // Back to the composer, as after sending.
  nextTick(() => actions.focusComposer())
}
async function save() {
  if (saving.value) return
  if (!draft.value.trim()) {
    chat.notify(t('messageEdit.empty'))
    return
  }
  saving.value = true
  const ok = await chat.edit(props.message, draft.value)
  saving.value = false
  if (ok) cancel()
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void save()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }
}
</script>
<template>
  <div class="message-editor mt-0.5 mr-0 mb-1 ml-0">
    <div
      ref="input"
      :contenteditable="saving ? 'false' : 'true'"
      role="textbox"
      aria-multiline="true"
      dir="auto"
      class="block w-full min-h-[38px] max-h-80 overflow-y-auto py-2 px-3 border border-solid border-[var(--line)] rounded-md bg-secondary text-body font-chat text-[length:var(--message-size)] leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere] caret-[var(--accent)] focus:outline-2 focus:outline-primary focus:outline-offset-[-1px] aria-disabled:opacity-60"
      :aria-label="$t('messageEdit.label')"
      :aria-disabled="saving || undefined"
      @keydown="keydown"
    />
    <p class="message-editor-hint mt-1 mr-0 mb-0 ml-0 text-[0.75rem] text-muted-foreground">
      <i18n-t
        keypath="messageEdit.shortcuts"
        tag="span"
      >
        <template #cancel
          ><UiButton
            variant="inline"
            size="inline"
            type="button"
            @click="cancel"
            >{{ $t('messageEdit.cancel') }}</UiButton
          ></template
        >
        <template #save
          ><UiButton
            variant="inline"
            size="inline"
            type="button"
            :disabled="saving"
            @click="save"
            >{{ $t('messageEdit.save') }}</UiButton
          ></template
        >
      </i18n-t>
    </p>
  </div>
</template>
