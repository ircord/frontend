<script setup lang="ts" vapor>
/**
 * "New encrypted group": a title and the people to add, by account. They can be on any IRCord
 * server of the home network. The group gets its own invite-only channel; each person gets an
 * invitation to join or decline.
 */
const { t } = useI18n()
const chat = useChatStore()
const e2ee = useE2eeStore()
const navigation = useConversationNavigation()
const title = ref('')
const entry = ref('')
const people = ref<string[]>([])
const busy = ref(false)
const problem = ref('')

function addEntry() {
  for (const name of entry.value.split(/[\s,]+/).filter(Boolean))
    if (!people.value.some((p) => p.toLowerCase() === name.toLowerCase())) people.value.push(name)
  entry.value = ''
}
function close() {
  e2ee.groupDialog = false
}

async function create() {
  addEntry()
  busy.value = true
  problem.value = ''
  try {
    const id = await e2ee.createGroup(title.value, people.value)
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
        <label
          class="font-[600]"
          for="encryption-group-people"
          >{{ t('encryption.group.peopleLabel') }}</label
        >
        <p class="m-0 text-muted-foreground">{{ t('encryption.group.peopleHelp') }}</p>
        <div class="flex gap-2">
          <UiInput
            id="encryption-group-people"
            v-model="entry"
            class="min-w-0 flex-1"
            :placeholder="t('encryption.group.addPlaceholder')"
            data-group-people
            @keydown.enter.prevent="addEntry"
          />
          <UiButton
            type="button"
            variant="secondary"
            :disabled="!entry.trim()"
            @click="addEntry"
          >
            {{ t('encryption.group.addPerson') }}
          </UiButton>
        </div>
        <ul
          v-if="people.length"
          class="m-0 flex list-none flex-wrap gap-1.5 p-0"
          data-group-chosen
        >
          <li
            v-for="(p, i) in people"
            :key="p"
          >
            <UiBadge
              variant="secondary"
              class="gap-1"
              >{{ p
              }}<button
                type="button"
                class="text-muted-foreground hover:text-foreground"
                :aria-label="t('encryption.group.removeChosen', { name: p })"
                @click="people.splice(i, 1)"
              >
                <AppIcon
                  name="close"
                  :size="11"
                /></button
            ></UiBadge>
          </li>
        </ul>
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
          :disabled="busy || !e2ee.ready || !title.trim() || (!people.length && !entry.trim())"
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
