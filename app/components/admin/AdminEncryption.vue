<script setup vapor lang="ts">
import type { components } from '../../../shared/generated/api'

type Setting = components['schemas']['EncryptionSetting']
type Mode = Setting['mode']

/**
 * Administration → Encryption: owners turn experimental end-to-end encrypted direct messages on
 * or off for this server, effective at once. When the server's configuration fixes the mode
 * (IRCORD_E2EE), the backend reports it locked and refuses changes, so the choice is read-only.
 */
const { t } = useI18n()
const errorMessage = (value: unknown) => errorText(value, (key) => t(key))
const refused = useAdministrationRefusal()
const { say } = useStatusAnnouncer()
const { full } = useTimeFormat()

const setting = ref<Setting>()
const loading = ref(false)
const saving = ref(false)
const error = ref<unknown>()
const notice = ref('')
const chat = useChatStore()
watch(notice, (text) => text && say(text))
/** The choice on screen; it follows the server's mode and returns to it when a save fails. */
const chosen = ref<Mode>('off')
watch(setting, (value) => value && (chosen.value = value.mode))

async function load() {
  loading.value = true
  error.value = undefined
  try {
    setting.value = await apiClient().administrationEncryption()
  } catch (e) {
    refused(e)
    error.value = e
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function choose(mode: Mode) {
  if (!setting.value || setting.value.locked || saving.value || mode === setting.value.mode) return
  saving.value = true
  error.value = undefined
  notice.value = ''
  try {
    setting.value = await apiClient().saveEncryptionSetting({ mode })
    notice.value =
      mode === 'off'
        ? t('administration.encryption.savedOff')
        : t('administration.encryption.savedOn')
    // Clients learn the encryption capability from the snapshot: refresh this one's now.
    chat.resync()
  } catch (e) {
    refused(e)
    if (setting.value) chosen.value = setting.value.mode
    // A 409 usually means the server configuration fixed the mode after this page loaded:
    // reread it, and when it is now locked, the lock note explains the refusal.
    if (errorStatus(e) === 409) {
      try {
        setting.value = await apiClient().administrationEncryption()
        if (setting.value.locked) {
          notice.value = t('administration.encryption.nowLocked')
          return
        }
      } catch {
        // Keep the original error.
      }
    }
    error.value = e
  } finally {
    saving.value = false
  }
}

const options = computed(() => [
  { value: 'off' as Mode, label: t('administration.encryption.off') },
  { value: 'experimental' as Mode, label: t('administration.encryption.experimental') },
])
</script>
<template>
  <div class="admin-page admin-encryption grid gap-7">
    <SettingsDescription>{{ t('administration.encryption.intro') }}</SettingsDescription>
    <FieldHint v-if="loading && !setting">{{ t('administration.encryption.loading') }}</FieldHint>
    <UiAlert
      v-if="error"
      as="div"
      variant="destructive"
      presentation="inline"
      class="form-error"
    >
      <p class="m-0">{{ errorMessage(error) }}</p>
      <UiButton
        variant="link"
        size="text"
        @click="load"
        >{{ t('administration.encryption.reload') }}</UiButton
      >
    </UiAlert>
    <template v-if="setting">
      <SettingRow
        :label="t('administration.encryption.mode')"
        :description="t('administration.encryption.modeHelp')"
      >
        <AppSegmented
          v-model="chosen"
          :options="options"
          :label="t('administration.encryption.mode')"
          :disabled="setting.locked || saving"
          @change="choose"
        />
      </SettingRow>
      <SettingNote
        v-if="setting.locked"
        class="encryption-locked"
        ><AppIcon
          name="lock"
          :size="15"
          class="mt-0.5 shrink-0"
        /><span class="grid gap-0.5"
          ><strong class="text-foreground">{{ t('administration.encryption.locked') }}</strong
          ><span>{{
            setting.lockReason || t('administration.encryption.lockedFallback')
          }}</span></span
        ></SettingNote
      >
      <SettingGroup :title="t('administration.encryption.aboutTitle')">
        <ul class="encryption-about m-0 grid gap-2 pl-5 text-[13px] text-body">
          <li>{{ t('administration.encryption.aboutExperimental') }}</li>
          <li>{{ t('administration.encryption.aboutReview') }}</li>
          <li>{{ t('administration.encryption.aboutOff') }}</li>
        </ul>
      </SettingGroup>
      <FieldHint v-if="notice">{{ notice }}</FieldHint>
      <FieldHint v-else-if="setting.updatedAt && !setting.locked">{{
        setting.updatedBy
          ? t('administration.encryption.lastChanged', {
              account: setting.updatedBy,
              time: full(setting.updatedAt),
            })
          : t('administration.encryption.lastChangedAt', { time: full(setting.updatedAt) })
      }}</FieldHint>
    </template>
  </div>
</template>
