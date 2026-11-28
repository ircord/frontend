<script setup lang="ts" vapor>
/**
 * "New encrypted group": a title and the people to add, by account. They can be on any IRCord
 * server of the home network. The group gets its own invite-only channel; each person gets an
 * invitation to join or decline. People without encryption join once they set it up.
 */
import { typedAccounts } from '../../../shared/e2ee/people'

const { t } = useI18n()
const chat = useChatStore()
const e2ee = useE2eeStore()
const navigation = useConversationNavigation()
const title = ref('')
const entry = ref('')
const people = ref<string[]>([])
const blocked = ref(false)
const picker = ref<{ nicks: () => Record<string, string> } | null>(null)
const busy = ref(false)
const problem = ref('')

/** Account names left typed in the field count as chosen. */
function addEntry() {
  for (const name of typedAccounts(entry.value))
    if (!people.value.some((p) => p.toLowerCase() === name.toLowerCase()))
      people.value = [...people.value, name]
  entry.value = ''
}
function close() {
  e2ee.groupDialog = false
}

async function create() {
  addEntry()
  // Names left in the field become chips first, with any reason they cannot join.
  await nextTick()
  if (blocked.value) return
  busy.value = true
  problem.value = ''
  try {
    const id = await e2ee.createGroup(title.value, people.value, picker.value?.nicks() ?? {})
    // The channel appears once the server reports the conversation.
    for (let i = 0; i < 40 && id && !chat.data?.conversations.some((c) => c.id === id); i++)
      await new Promise((resolve) => setTimeout(resolve, 250))
    close()
    if (id) await navigation.open(id)
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <AppDialog
    :title="t('encryption.group.newGroup')"
    @close="close"
  >
    <form
      class="encryption-new-group grid gap-4 pt-0 pr-5 pb-5 pl-5 text-[13px] text-body"
      data-encryption-new-group
      @submit.prevent="create"
    >
      <p class="m-0 flex items-center gap-2">
        <UiBadge variant="secondary">{{ t('encryption.experimental') }}</UiBadge>
        <span class="text-muted-foreground">{{ t('encryption.experimentalHelp') }}</span>
      </p>
      <p class="m-0">{{ t('encryption.group.intro') }}</p>
      <label class="grid gap-1.5">
        <span class="font-[600]">{{ t('encryption.group.titleLabel') }}</span>
        <UiInput
          v-model="title"
          maxlength="100"
          :placeholder="t('encryption.group.titlePlaceholder')"
          data-group-title
        />
      </label>
      <div class="grid gap-1.5">
        <span class="font-[600]">{{ t('encryption.group.peopleLabel') }}</span>
        <p class="m-0 text-muted-foreground">{{ t('encryption.group.peopleHelp') }}</p>
        <EncryptionPeoplePicker
          ref="picker"
          v-model="people"
          v-model:query="entry"
          v-model:blocked="blocked"
        />
      </div>
      <div
        class="encryption-trust flex gap-2.5 rounded-md border border-border bg-card px-3 py-2.5"
        data-encryption-trust
      >
        <AppIcon
          name="shieldAlert"
          :size="16"
          class="mt-0.5 shrink-0 text-warning"
        />
        <div class="grid gap-1.5">
          <p class="m-0">{{ t('encryption.group.trust') }}</p>
          <p class="m-0 text-muted-foreground">{{ t('encryption.webLimit') }}</p>
        </div>
      </div>
      <p
        v-if="!e2ee.ready"
        class="m-0 text-muted-foreground"
      >
        {{ t('encryption.blocked.deviceNotReady') }}
      </p>
      <p
        v-if="problem"
        class="m-0 text-destructive"
        role="alert"
      >
        {{ problem }}
      </p>
      <div class="form-actions mt-1 flex items-center justify-end gap-2">
        <UiButton
          type="button"
          variant="secondary"
          @click="close"
        >
          {{ t('encryption.approval.cancel') }}
        </UiButton>
        <UiButton
          type="submit"
          :disabled="
            busy || blocked || !e2ee.ready || !title.trim() || (!people.length && !entry.trim())
          "
          data-group-create
        >
          <AppIcon
            name="lock"
            :size="15"
          />{{ busy ? t('encryption.group.creating') : t('encryption.group.create') }}
        </UiButton>
      </div>
    </form>
  </AppDialog>
</template>
