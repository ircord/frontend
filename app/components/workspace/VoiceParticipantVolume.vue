<script setup vapor lang="ts">
import { Volume2 } from '@lucide/vue'

const props = defineProps<{ identity: string; name: string; speaking: boolean }>()
const voice = useVoiceStore()
const { t, n } = useI18n()
const volume = computed(() => voice.participantVolume(props.name))
const label = computed(() => t('workspaceUi.voice.participantVolume', { name: props.name }))
const headingId = useId()
</script>

<template>
  <UiPopover>
    <UiPopoverTrigger v-slot="{ bind, setTrigger }">
      <button
        :ref="setTrigger"
        v-bind="bind"
        type="button"
        :aria-label="label"
        :title="label"
        class="inline-flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        :class="speaking && 'text-foreground'"
      >
        <span class="truncate">{{ name }}</span>
        <Volume2
          :size="12"
          class="shrink-0"
          aria-hidden="true"
        />
      </button>
    </UiPopoverTrigger>
    <UiPopoverContent
      align="start"
      :aria-labelledby="headingId"
      class="w-60 space-y-2.5 p-3"
    >
      <h4
        :id="headingId"
        class="truncate text-sm font-semibold"
      >
        {{ label }}
      </h4>
      <div class="flex items-center gap-3">
        <UiSlider
          :model-value="[volume]"
          :max="voice.maxParticipantVolume"
          :label="label"
          @update:model-value="voice.setParticipantVolume(identity, $event[0]!)"
        />
        <output class="min-w-10 text-right text-xs text-muted-foreground tabular-nums">
          {{ n(volume) }}%
        </output>
      </div>
      <UiButton
        v-if="volume !== 100"
        variant="ghost"
        size="sm"
        @click="voice.setParticipantVolume(identity, 100)"
      >
        {{ t('workspaceUi.voice.resetVolume') }}
      </UiButton>
    </UiPopoverContent>
  </UiPopover>
</template>
