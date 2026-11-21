<script setup vapor lang="ts">
import type { components } from '../../../shared/generated/api'

type Management = components['schemas']['EmojiManagement']
type User = components['schemas']['AdminUser']

/**
 * Administration → Emoji: by default everyone signed in manages the shared emoji catalog. An
 * owner can limit that to a list of accounts; owners always keep it.
 */
const { t } = useI18n()
const errorMessage = (value: unknown) => errorText(value, (key) => t(key))
const state = ref<Management>()
const error = ref<unknown>()
const notice = ref('')
const busy = ref(false)
const refused = useAdministrationRefusal()
const { say } = useStatusAnnouncer()
watch(notice, (text) => text && say(text))

async function load() {
  try {
    state.value = await apiClient().administrationEmoji()
  } catch (e) {
    refused(e)
    error.value = e
  }
}
onMounted(load)

async function save(restricted: boolean, managers: User[]) {
  busy.value = true
  error.value = undefined
  notice.value = ''
  try {
    state.value = await apiClient().saveEmojiManagement({
      restricted,
      managers: managers.map((user) => user.id),
    })
  } catch (e) {
    refused(e)
    error.value = e
  } finally {
    busy.value = false
  }
}
const managers = computed(() => state.value?.managers ?? [])
function add(user: User) {
  if (!state.value) return
  if (managers.value.some((m) => m.id === user.id)) {
    notice.value = t('administration.emojiManagement.already', { username: user.username })
    return
  }
  void save(state.value.restricted, [...managers.value, user])
}
function remove(user: User) {
  if (state.value)
    void save(
      state.value.restricted,
      managers.value.filter((m) => m.id !== user.id),
    )
}
</script>
<template>
  <div class="admin-page grid gap-7">
    <SettingsDescription>{{ t('administration.emojiManagement.intro') }}</SettingsDescription>
    <UiAlert
      v-if="error"
      as="p"
      variant="destructive"
      presentation="inline"
      class="form-error"
      >{{ errorMessage(error) }}</UiAlert
    >
    <template v-if="state">
      <SettingRow
        :label="t('administration.emojiManagement.limit')"
        :description="t('administration.emojiManagement.limitHelp')"
      >
        <AppSwitch
          :model-value="state.restricted"
          :disabled="busy"
          :aria-label="t('administration.emojiManagement.limit')"
          @update:model-value="save($event, managers)"
        />
      </SettingRow>
      <SettingGroup :title="t('administration.emojiManagement.managers')">
        <AdminAccountPicker
          :label="t('collectionsUi.admin.usernameOrNickname')"
          :action="t('administration.emojiManagement.add')"
          :owner-note="t('administration.emojiManagement.ownerNote')"
          :busy="busy"
          @choose="add"
        />
        <FieldHint v-if="notice">{{ notice }}</FieldHint>
        <ul
          v-if="managers.length"
          class="admin-emoji-managers mt-3 list-none m-0 p-0 grid gap-2"
        >
          <li
            v-for="user in managers"
            :key="user.id"
            class="flex items-center gap-3 rounded-[var(--radius-large)] bg-card px-3.5 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border)_55%,transparent)]"
          >
            <span
              aria-hidden="true"
              class="grid size-8 shrink-0 place-items-center rounded-full bg-selection text-[13px] font-[700] text-primary uppercase"
              >{{ user.username.slice(0, 1) }}</span
            >
            <strong class="min-w-0 flex-1 truncate">{{ user.username }}</strong>
            <UiButton
              variant="secondary"
              size="sm"
              :disabled="busy"
              :aria-label="
                t('administration.emojiManagement.removeManager', { username: user.username })
              "
              @click="remove(user)"
              >{{ t('administration.emojiManagement.remove') }}</UiButton
            >
          </li>
        </ul>
        <SettingsDescription
          v-else
          class="mt-3"
          >{{ t('administration.emojiManagement.none') }}</SettingsDescription
        >
      </SettingGroup>
    </template>
  </div>
</template>
