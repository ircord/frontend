<script setup vapor lang="ts">
import type { components } from '../../../shared/generated/api'
import { errorText } from '../../utils/api'

type Schema = components['schemas']
const props = defineProps<{ room?: Schema['Room'] }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const { t, n } = useI18n()
const name = ref(props.room?.name ?? '')
const rates = [24, 32, 48, 64, 96, 128, 160, 192] as const
type Rate = (typeof rates)[number]
const initialRate = rates.find((rate) => rate === props.room?.bitrateKbps) ?? 48
const bitrate = ref<Rate>(initialRate)
const rateOptions = computed(() =>
  rates.map((rate) => ({
    value: String(rate),
    label: t('workspaceUi.voice.bitrate', { bitrate: n(rate) }),
  })),
)
const busy = ref(false)
const error = ref('')
const nameID = useId()

async function save() {
  if (busy.value || !name.value.trim()) return
  error.value = ''
  busy.value = true
  try {
    const settings = { name: name.value.trim(), bitrateKbps: bitrate.value }
    const client = apiClient()
    if (props.room) await client.updateVoiceRoom(props.room.id, settings)
    else await client.createVoiceRoom(settings)
    emit('saved')
  } catch (failure) {
    error.value = errorText(failure)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppDialog
    :title="t(room ? 'workspaceUi.voice.editRoom' : 'workspaceUi.voice.createRoom')"
    :before-close="() => !busy"
    @close="emit('close')"
  >
    <form
      class="grid gap-4 px-5 pb-5"
      @submit.prevent="save"
    >
      <SettingsDescription>
        {{ t('workspaceUi.voice.roomAccess') }}
      </SettingsDescription>
      <div class="grid gap-1.5">
        <label
          :for="nameID"
          class="text-sm font-medium"
          >{{ t('workspaceUi.voice.roomName') }}</label
        >
        <UiInput
          :id="nameID"
          v-model="name"
          :maxlength="60"
          :disabled="busy"
          required
          autofocus
        />
      </div>
      <div class="grid gap-1.5">
        <span class="text-sm font-medium">{{ t('workspaceUi.voice.audioQuality') }}</span>
        <AppSelect
          :model-value="String(bitrate)"
          :options="rateOptions"
          :disabled="busy"
          :aria-label="t('workspaceUi.voice.audioQuality')"
          @change="(value) => (bitrate = rates.find((rate) => String(rate) === value) ?? 48)"
        />
        <SettingsDescription>{{ t('workspaceUi.voice.bitrateHelp') }}</SettingsDescription>
      </div>
      <p
        v-if="error"
        role="alert"
        class="text-sm text-destructive"
      >
        {{ error }}
      </p>
      <div class="flex justify-end gap-2">
        <UiButton
          type="button"
          variant="ghost"
          :disabled="busy"
          @click="emit('close')"
          >{{ t('common.cancel') }}</UiButton
        >
        <UiButton
          type="submit"
          :disabled="busy || !name.trim()"
        >
          {{ t(busy ? 'common.saving' : room ? 'common.save' : 'workspaceUi.voice.createAction') }}
        </UiButton>
      </div>
    </form>
  </AppDialog>
</template>
