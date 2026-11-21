<script setup vapor lang="ts">
import { channelRights, topPrefix } from '../../../shared/utils/irc'
import { listInfo, parseChanmodes } from '../../../shared/utils/channel-modes'
import type { components } from '../../../shared/generated/api'
import type { NavTone } from '../../../shared/settings-index'

/** Channel settings frame. Each section owns its forms and permission checks. */
const props = defineProps<{ conversationId: string; initialTab?: string }>()
const emit = defineEmits<{ close: [] }>()
const chat = useChatStore()
const { t } = useI18n()
const translate = (key: string, values?: Record<string, string | number>) => t(key, values ?? {})
const c = computed(() => chat.data?.conversations.find((x) => x.id === props.conversationId))
const network = computed(() => (c.value ? chat.networkOf(c.value) : undefined))
const name = computed(() => `#${c.value?.name ?? ''}`)
const rights = computed(() => channelRights('you', c.value, network.value))
const groups = computed(() => parseChanmodes(network.value?.isupport))
const myPrefix = computed(() => topPrefix('you', c.value, network.value))
// Without a tab, phones open on the section list and wider screens on Overview.
const tab = ref(props.initialTab || 'overview')
useViewHistory('channel-settings-section', tab)
const pages = useSettingsPages('channel-settings', !props.initialTab)
const currentLabel = computed(() => tabs.value.find((item) => item.id === tab.value)?.label ?? '')
const listLabels = computed(() => listInfo(translate))
// The channel guide tab exists only for channels on this server's own network (#258).
const guideListing = ref<components['schemas']['ChannelGuideListing']>()
watch(
  () => props.conversationId,
  async (id) => {
    guideListing.value = undefined
    try {
      const listing = await apiClient().guideListing(id)
      if (id === props.conversationId) guideListing.value = listing
    } catch {
      // Without the listing the tab stays hidden; the rest of the settings still work.
    }
  },
  { immediate: true },
)
/** Icons for the usual list modes: bans, their exceptions, invite exceptions and quiets. */
const listIcons: Record<string, { icon: string; tone: NavTone }> = {
  b: { icon: 'gavel', tone: 'red' },
  e: { icon: 'check', tone: 'green' },
  I: { icon: 'mail', tone: 'cyan' },
  q: { icon: 'muted', tone: 'orange' },
}
const tabs = computed<{ id: string; label: string; icon: string; tone: NavTone }[]>(() => [
  {
    id: 'overview',
    label: t('collectionsUi.channel.settings.overview'),
    icon: 'hash',
    tone: 'blue',
  },
  {
    id: 'modes',
    label: t('collectionsUi.channel.settings.modes'),
    icon: 'filters',
    tone: 'purple',
  },
  {
    id: 'registration',
    label: t('collectionsUi.channel.settings.registration'),
    icon: 'key',
    tone: 'yellow',
  },
  ...(guideListing.value?.available
    ? [
        {
          id: 'guide',
          label: t('channelGuide.listing.tab'),
          icon: 'compass',
          tone: 'pink' as const,
        },
      ]
    : []),
  ...[...groups.value.list].map((mode) => ({
    id: `list:${mode}`,
    label: listLabels.value[mode]?.label ?? t('collectionsUi.channel.listModeFallback', { mode }),
    ...(listIcons[mode] ?? { icon: 'lock', tone: 'blue' as const }),
  })),
])
const listMode = computed(() => (tab.value.startsWith('list:') ? tab.value.slice(5) : ''))
const rankPhrase = (prefix: string) =>
  t(
    prefix === '~'
      ? 'collectionsUi.channel.settings.owner'
      : prefix === '&'
        ? 'collectionsUi.channel.settings.admin'
        : 'collectionsUi.channel.settings.operator',
  )
</script>
<template>
  <AppDialog
    :title="
      pages.inSection ? currentLabel : t('collectionsUi.channel.settings.title', { channel: name })
    "
    :back="
      pages.inSection
        ? t('settings.backTo', {
            name: t('collectionsUi.channel.settings.title', { channel: name }),
          })
        : undefined
    "
    panel
    @back="pages.back()"
    @close="emit('close')"
  >
    <SettingsLayout
      v-if="c"
      :label="t('collectionsUi.channel.settings.label')"
      :pages="pages"
      class="channel-settings"
    >
      <template #nav>
        <SettingsNavItem
          v-for="item in tabs"
          :key="item.id"
          :icon="item.icon"
          :tone="item.tone"
          :active="tab === item.id"
          @click="tab = item.id"
          >{{ item.label }}</SettingsNavItem
        >
      </template>
      <div
        class="settings-content [grid-area:content] pt-5 pr-7 pb-7 pl-7 overflow-y-auto max-[700px]:p-4"
      >
        <!-- ChanServ permissions follow accounts, not channel rank. -->
        <p
          v-if="tab !== 'registration' && tab !== 'guide'"
          class="rank-note mb-5 inline-flex w-fit max-w-full items-center gap-2 rounded-full py-1.5 pr-3.5 pl-2.5 text-[length:var(--ui-caption)] font-[550]"
          :class="
            rights.op
              ? 'can-edit bg-success/12 text-success shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--mint)_30%,transparent)]'
              : 'bg-secondary/45 text-muted-foreground'
          "
        >
          <AppIcon
            :name="rights.op ? 'shield' : 'lock'"
            :size="15"
          />
          <span v-if="rights.op">{{
            t('collectionsUi.channel.settings.canChangeEverything', { rank: rankPhrase(myPrefix) })
          }}</span>
          <span v-else-if="rights.kick">{{
            t('collectionsUi.channel.settings.canManageLists')
          }}</span>
          <span v-else>{{
            t('collectionsUi.channel.settings.readOnly', { prefix: '@', channel: name })
          }}</span>
        </p>
        <ChannelOverview
          v-if="tab === 'overview'"
          :c="c"
          :network="network"
          :rights="rights"
          @close="emit('close')"
        />
        <ChannelModes
          v-else-if="tab === 'modes'"
          :c="c"
          :network="network"
          :rights="rights"
        />
        <ChannelRegistration
          v-else-if="tab === 'registration'"
          :conversation-id="conversationId"
          :name="name"
          :network-name="network?.name ?? t('collectionsUi.channel.settings.thisNetwork')"
          :op="rights.op"
          :account="network?.account"
        />
        <ChannelGuideListing
          v-else-if="tab === 'guide' && guideListing"
          :key="conversationId"
          :conversation-id="conversationId"
          :name="name"
          :listing="guideListing"
          @update="guideListing = $event"
        />
        <ChannelModeList
          v-else
          :key="listMode"
          :c="c"
          :network="network"
          :rights="rights"
          :list-mode="listMode"
        />
      </div>
    </SettingsLayout>
  </AppDialog>
</template>
