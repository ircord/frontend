<script setup vapor lang="ts">
/** One person in a suggestion list: picture with presence, display name and @nick. */
import type { Member } from '../../../shared/types/chat'

defineProps<{ member: Member }>()
const nameStyle = useNameStyle()
</script>

<template>
  <UserAvatar
    :member="member"
    size="tiny"
    presence
  />
  <span
    class="suggestion-name min-w-0 flex-1 truncate"
    :style="nameStyle(member)"
    >{{ member.displayName || member.nick }}</span
  >
  <span class="suggestion-code shrink-0 text-[12px] text-faint">@{{ member.nick }}</span>
</template>
