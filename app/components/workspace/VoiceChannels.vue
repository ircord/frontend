<script setup vapor lang="ts">
import { Volume2 } from '@lucide/vue'
import type { components } from '../../../shared/generated/api'
import { voiceRoomsInSidebar } from '../../../shared/utils/voice-sidebar'
import { administrationAccessQuery } from '../../queries/administration'
import { errorText } from '../../utils/api'

type VoiceRoom = components['schemas']['Room']

const voice = useVoiceStore()
const layout = useLayoutStore()
const owner = useQuery(administrationAccessQuery)
const canManage = computed(() => voice.enabled && owner.data.value?.owner === true)
const editor = shallowRef<{ room?: VoiceRoom }>()
const menu = useContextMenu()
const { confirm } = usePrompt()
const managementError = ref('')
const { t, n } = useI18n()
const headingId = useId()
const listId = useId()
const collapsed = computed(() => layout.collapsed('server', 'voice'))
const rooms = computed(() => (voice.enabled ? (voice.rooms.data ?? []) : []))
const displayedRooms = computed(() =>
  voiceRoomsInSidebar(rooms.value, collapsed.value, voice.active?.id),
)
const callStatus = computed(() => {
  if (voice.state === 'joining') return t('workspaceUi.voice.joining')
  if (voice.state === 'reconnecting') return t('workspaceUi.voice.reconnecting')
  return t('workspaceUi.voice.connected')
})
const joinError = computed(() => {
  if (voice.error === 'connectFailed') return t('workspaceUi.voice.connectFailed')
  if (voice.error === 'connectionEnded') return ''
  return voice.error
})

function isActive(room: VoiceRoom) {
  return voice.active?.id === room.id
}

function joinBlock(room: VoiceRoom) {
  if (!room.available) return t('workspaceUi.voice.unavailable')
  if (room.participants.length >= room.capacity) return t('workspaceUi.voice.full')
  if (voice.echoState !== 'idle') return t('workspaceUi.voice.testingMicrophone')
  if (voice.state !== 'idle') return t('workspaceUi.voice.otherCall')
  return ''
}

function countLabel(room: VoiceRoom) {
  const count = room.participants.length
  return t('workspaceUi.voice.peopleInRoom', { count: n(count) }, count)
}

function openEditor(room?: VoiceRoom) {
  managementError.value = ''
  editor.value = { room }
}

function saved() {
  editor.value = undefined
  void voice.rooms.refetch()
}

async function removeRoom(room: VoiceRoom) {
  if (
    !(await confirm({
      title: t('workspaceUi.voice.deleteTitle', { name: room.name }),
      body: t('workspaceUi.voice.deleteDescription'),
      confirm: t('workspaceUi.voice.deleteRoom'),
      danger: true,
    }))
  )
    return
  managementError.value = ''
  try {
    await apiClient().deleteVoiceRoom(room.id)
    void voice.rooms.refetch()
  } catch (failure) {
    managementError.value = errorText(failure)
  }
}

function roomMenu(event: MouseEvent, room: VoiceRoom) {
  if (!canManage.value) return
  menu.open(
    event,
    [
      {
        label: t('workspaceUi.voice.editRoom'),
        icon: 'pencil',
        action: () => openEditor(room),
      },
      {
        label: t('workspaceUi.voice.deleteRoom'),
        icon: 'trash',
        danger: true,
        action: () => void removeRoom(room),
      },
    ],
    room.name,
  )
}
</script>

<template>
  <section
    v-if="rooms.length || canManage"
    class="sidebar-section"
    :aria-labelledby="headingId"
  >
    <div
      class="sidebar-section-heading mb-0.5 mt-4 flex h-7 items-center justify-between gap-1.5 pl-2 pr-1 text-[length:var(--ui-small)] font-medium tracking-[-0.01em] text-muted-foreground [@media(pointer:coarse)]:min-h-[44px]"
    >
      <h2
        :id="headingId"
        class="h-full min-w-0 [font:inherit] tracking-[inherit]"
      >
        <button
          type="button"
          class="section-toggle -ml-1.5 flex h-full min-w-0 items-center gap-1.5 rounded-sm pl-0.5 pr-1 text-inherit [font:inherit] tracking-[inherit] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&>svg]:shrink-0 [&>svg]:transition-transform [&>svg]:duration-150 aria-[expanded=false]:[&>svg]:-rotate-90"
          :aria-expanded="!collapsed"
          :aria-controls="listId"
          @click="layout.toggleSection('server', 'voice')"
        >
          <AppIcon
            name="down"
            :size="12"
            aria-hidden="true"
          />
          <span class="truncate">{{ t('workspaceUi.voice.channels') }}</span>
        </button>
      </h2>
      <UiButton
        v-if="canManage"
        variant="ghost"
        size="icon-sm"
        class="size-[22px] shrink-0 rounded-full [@media(pointer:coarse)]:size-11"
        :aria-label="t('workspaceUi.voice.createRoom')"
        :title="t('workspaceUi.voice.createRoom')"
        @click="openEditor()"
        ><AppIcon
          name="plus"
          :size="14"
          aria-hidden="true"
      /></UiButton>
    </div>

    <ul
      v-show="displayedRooms.length"
      :id="listId"
      class="m-0 grid list-none gap-0.5 p-0"
    >
      <li
        v-for="room in displayedRooms"
        :key="room.id"
        class="min-w-0"
      >
        <div
          class="group flex min-w-0 items-center rounded-[9px]"
          :class="isActive(room) ? 'bg-selection text-foreground' : 'hover:bg-accent'"
          @contextmenu="roomMenu($event, room)"
        >
          <div
            v-if="isActive(room)"
            aria-current="true"
            class="flex min-h-[calc(var(--row-height)_-_4px)] min-w-0 flex-1 items-center gap-2.5 px-2.5 text-[length:var(--ui-text)] font-medium [@media(pointer:coarse)]:min-h-[44px]"
          >
            <Volume2
              :size="15"
              class="shrink-0 text-success"
              aria-hidden="true"
            />
            <span
              class="truncate"
              :title="room.name"
              >{{ room.name }}</span
            >
            <span class="sr-only">{{ callStatus }}</span>
          </div>
          <ConversationLink
            v-else
            class="min-w-0 flex-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:hover:bg-transparent"
            :disabled="!!joinBlock(room)"
            :aria-label="t('workspaceUi.voice.join', { channel: room.name })"
            :aria-description="joinBlock(room) || undefined"
            :title="joinBlock(room) || t('workspaceUi.voice.join', { channel: room.name })"
            @click="voice.join(room)"
            @contextmenu.stop="roomMenu($event, room)"
          >
            <Volume2
              :size="15"
              class="shrink-0"
              aria-hidden="true"
            />
            <span class="flex-1 truncate">{{ room.name }}</span>
            <span
              v-if="!room.available || room.participants.length >= room.capacity"
              class="shrink-0 text-[length:var(--ui-caption)] text-muted-foreground"
            >
              {{
                t(
                  room.available
                    ? 'workspaceUi.voice.fullLabel'
                    : 'workspaceUi.voice.unavailableLabel',
                )
              }}
            </span>
          </ConversationLink>
          <UiButton
            v-if="canManage"
            variant="ghost"
            size="icon-sm"
            class="mr-1 size-6 shrink-0 rounded-md text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-11"
            aria-haspopup="menu"
            :aria-label="t('workspaceUi.voice.roomActions', { room: room.name })"
            :title="t('workspaceUi.voice.roomActions', { room: room.name })"
            @click="roomMenu($event, room)"
            ><AppIcon
              name="more"
              :size="14"
              aria-hidden="true"
          /></UiButton>
        </div>

        <ul
          v-if="!collapsed && isActive(room) && voice.participants.length"
          class="ml-5 mt-1 grid gap-0.5 border-l border-border/70 py-0.5 pl-3 pr-2"
          :aria-label="t('workspaceUi.voice.participantList', { channel: room.name })"
        >
          <li
            v-for="participant in voice.participants"
            :key="participant.identity"
            class="flex min-w-0 items-center gap-1.5 text-[length:var(--ui-caption)] text-muted-foreground"
          >
            <UserAvatar
              :member="{ displayName: participant.name }"
              size="tiny"
              :class="voice.speakers.includes(participant.identity) && 'ring-1 ring-primary'"
            />
            <span
              v-if="voice.speakers.includes(participant.identity)"
              class="sr-only"
              >{{ t('workspaceUi.voice.speaking') }}</span
            >
            <span
              v-if="participant.local"
              class="truncate px-1.5 py-1"
              >{{ participant.name }}</span
            >
            <VoiceParticipantVolume
              v-else
              :identity="participant.identity"
              :name="participant.name"
              :speaking="voice.speakers.includes(participant.identity)"
            />
          </li>
        </ul>
        <ul
          v-else-if="!collapsed && room.participants.length"
          class="ml-5 mt-1 grid gap-0.5 border-l border-border/70 py-0.5 pl-3 pr-2"
          :aria-label="countLabel(room)"
        >
          <li
            v-for="name in room.participants"
            :key="name"
            class="flex min-h-6 min-w-0 items-center gap-2.5 text-[length:var(--ui-caption)] text-muted-foreground"
          >
            <UserAvatar
              :member="{ displayName: name }"
              size="tiny"
            />
            <span class="truncate">{{ name }}</span>
          </li>
        </ul>
      </li>
    </ul>
    <p
      v-if="canManage && !rooms.length && !collapsed"
      class="px-2 py-1 text-[length:var(--ui-caption)] text-muted-foreground"
    >
      {{ t('workspaceUi.voice.noRooms') }}
    </p>
    <p
      v-if="managementError || (voice.state === 'idle' && joinError)"
      role="status"
      class="px-2 py-1.5 text-[length:var(--ui-caption)] text-destructive"
    >
      {{ managementError || joinError }}
    </p>
    <VoiceRoomDialog
      v-if="canManage && editor"
      :room="editor.room"
      @close="editor = undefined"
      @saved="saved"
    />
  </section>
</template>
