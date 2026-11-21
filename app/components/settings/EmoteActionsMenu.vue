<script setup vapor lang="ts">
import type { InstanceEmote } from '../../../shared/types/media'

/** The actions for one emote in Settings → Emotes. */
defineProps<{ emote: InstanceEmote; busy?: boolean }>()
const emit = defineEmits<{ rename: []; aliases: []; toggle: []; remove: [] }>()
const { t } = useI18n()
</script>
<template>
  <UiDropdownMenu>
    <UiDropdownMenuTrigger v-slot="{ bind, setTrigger }">
      <UiButton
        :ref="setTrigger"
        v-bind="bind"
        variant="ghost"
        size="icon-sm"
        class="emote-actions text-muted-foreground"
        :aria-label="t('emotes.manageAria', { shortcode: emote.shortcode })"
      >
        <AppIcon
          name="more"
          :size="18"
        />
      </UiButton>
    </UiDropdownMenuTrigger>
    <UiDropdownMenuContent align="end">
      <UiDropdownMenuLabel class="context-title">:{{ emote.shortcode }}:</UiDropdownMenuLabel>
      <UiDropdownMenuItem
        :disabled="busy"
        @select="emit('rename')"
      >
        <AppIcon
          name="pencil"
          :size="15"
        />{{ t('emotes.rename.label') }}
      </UiDropdownMenuItem>
      <UiDropdownMenuItem
        :disabled="busy"
        @select="emit('aliases')"
      >
        <AppIcon
          name="type"
          :size="15"
        />{{ t('emotes.editAliases') }}
      </UiDropdownMenuItem>
      <UiDropdownMenuItem
        :disabled="busy"
        @select="emit('toggle')"
      >
        <AppIcon
          :name="emote.enabled ? 'eyeOff' : 'eye'"
          :size="15"
        />{{ t(emote.enabled ? 'emotes.disable' : 'emotes.enable') }}
      </UiDropdownMenuItem>
      <UiDropdownMenuSeparator />
      <UiDropdownMenuItem
        variant="destructive"
        :disabled="busy"
        @select="emit('remove')"
      >
        <AppIcon
          name="trash"
          :size="15"
        />{{ t('emotes.removeAction') }}
      </UiDropdownMenuItem>
    </UiDropdownMenuContent>
  </UiDropdownMenu>
</template>
