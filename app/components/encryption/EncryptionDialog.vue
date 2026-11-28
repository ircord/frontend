<script setup lang="ts" vapor>
/**
 * One direct conversation's encryption: start it, verify the other person, or turn it off. Every
 * state shows the trust caveat in plain words, and the web client's limit. An encrypted group's
 * channel shows its group panel instead.
 */
const { t } = useI18n()
const chat = useChatStore()
const e2ee = useE2eeStore()
const actions = useWorkspaceActions()
const prompt = usePrompt()
const conversation = computed(() => chat.data?.conversations.find((c) => c.id === e2ee.panel))
const group = computed(() => e2ee.isGroupChannel(conversation.value))
const name = computed(() =>
  conversation.value
    ? (chat.directPartner(conversation.value)?.nick ?? conversation.value.name)
    : '',
)
const record = computed(() =>
  conversation.value ? e2ee.conversations[conversation.value.id] : undefined,
)
const encrypted = computed(() => !!record.value?.on)
const blocker = computed(() => e2ee.startBlocker(conversation.value))
const busy = ref(false)
const problem = ref('')

watch(
  () => [conversation.value?.id, encrypted.value, e2ee.ready] as const,
  async ([id, on, ready]) => {
    problem.value = ''
    const c = conversation.value
    if (!id || !c || !ready || on || group.value) return
    const peer = await e2ee.resolvePeer(c)
    if (peer) void e2ee.checkPeerKeys(peer)
  },
  { immediate: true },
)

function close() {
  e2ee.panel = ''
}

async function start() {
  if (!conversation.value) return
  busy.value = true
  problem.value = ''
  try {
    await e2ee.start(conversation.value)
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

function ask() {
  if (!conversation.value) return
  chat.send(t('encryption.dialog.askText'), undefined, undefined, {
    conversationId: conversation.value.id,
  })
  close()
}

async function turnOff() {
  const c = conversation.value
  if (!c) return
  const confirmed = await prompt.confirm({
    title: t('encryption.dialog.turnOffTitle'),
    body: t('encryption.dialog.turnOffBody', { name: name.value }),
    confirm: t('encryption.dialog.turnOff'),
    danger: true,
  })
  if (!confirmed) return
  busy.value = true
  problem.value = ''
  try {
    await e2ee.turnOff(c)
    chat.notify(t('encryption.dialog.turnedOff'))
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <EncryptionGroupPanel
    v-if="conversation && group"
    :conversation="conversation"
    @close="close"
  />
  <AppDialog
    v-else-if="conversation"
    :title="encrypted ? t('encryption.dialog.titleOn') : t('encryption.dialog.titleOff')"
    @close="close"
  >
    <div
      class="encryption-dialog grid gap-4 pt-0 pr-5 pb-5 pl-5 text-[13px] text-body"
      data-encryption-dialog
    >
      <p class="m-0 flex items-center gap-2">
        <UiBadge variant="secondary">{{ t('encryption.experimental') }}</UiBadge>
        <span class="text-muted-foreground">{{ t('encryption.experimentalHelp') }}</span>
      </p>

      <template v-if="!encrypted">
        <p class="m-0">{{ t('encryption.dialog.intro', { name }) }}</p>
        <p class="m-0">{{ t('encryption.dialog.noAccept', { name }) }}</p>
        <p class="m-0 text-muted-foreground">{{ t('encryption.dialog.lost') }}</p>
      </template>
      <template v-else>
        <p class="m-0 flex items-center gap-2 text-success">
          <AppIcon
            name="lock"
            :size="15"
          />{{ t('encryption.dialog.on') }}
        </p>
        <EncryptionVerify
          v-if="record"
          :peer="record.peer"
          :name="name"
        />
      </template>

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
          <p class="m-0">{{ t('encryption.trust', { name }) }}</p>
          <p
            v-if="e2ee.acrossServers"
            class="m-0"
          >
            {{ t('encryption.trustServers', { name }) }}
          </p>
          <p class="m-0 text-muted-foreground">{{ t('encryption.webLimit') }}</p>
        </div>
      </div>

      <p
        v-if="!e2ee.ready"
        class="m-0 text-muted-foreground"
      >
        {{
          e2ee.phase === 'elsewhere'
            ? t('encryption.settings.state.elsewhere')
            : t('encryption.blocked.deviceNotReady')
        }}
        <button
          v-if="e2ee.phase !== 'elsewhere'"
          type="button"
          class="text-primary underline-offset-2 hover:underline"
          @click="(close(), actions.settings('encryption'))"
        >
          {{ t('encryption.settings.section') }}
        </button>
      </p>
      <p
        v-else-if="!encrypted && blocker"
        class="m-0 text-muted-foreground"
        role="status"
      >
        {{ t(`encryption.blocked.${blocker}`, { name }) }}
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
          v-if="!encrypted && (blocker === 'peerNoKeys' || blocker === 'peerNoKeysAcross')"
          variant="secondary"
          @click="ask"
        >
          {{ t('encryption.dialog.askPeer', { name }) }}
        </UiButton>
        <UiButton
          v-if="!encrypted"
          :disabled="!!blocker || busy"
          data-encryption-start
          @click="start"
        >
          <AppIcon
            name="lock"
            :size="15"
          />{{ busy ? t('encryption.dialog.starting') : t('encryption.dialog.start') }}
        </UiButton>
        <UiButton
          v-else
          variant="destructive"
          :disabled="busy"
          @click="turnOff"
        >
          <AppIcon
            name="lockOpen"
            :size="15"
          />{{ t('encryption.dialog.turnOff') }}
        </UiButton>
      </div>
    </div>
  </AppDialog>
</template>
