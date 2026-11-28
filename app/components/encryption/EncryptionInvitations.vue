<script setup lang="ts" vapor>
/**
 * Invitations to encrypted groups: "Peter invited you to the encrypted group 'Weekend plans'",
 * with Join and Decline. The title is read from the group's Welcome, which the server cannot read.
 */
const { t } = useI18n()
const e2ee = useE2eeStore()
const navigation = useConversationNavigation()
const chat = useChatStore()
const busy = ref('')
const problem = ref('')

async function answer(groupId: string, join: boolean) {
  busy.value = groupId
  problem.value = ''
  try {
    if (!join) return void (await e2ee.declineInvitation(groupId))
    const id = await e2ee.joinInvitation(groupId)
    for (let i = 0; i < 40 && id && !chat.data?.conversations.some((c) => c.id === id); i++)
      await new Promise((resolve) => setTimeout(resolve, 250))
    if (id) await navigation.open(id)
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = ''
  }
}
</script>
<template>
  <div
    v-if="e2ee.ready && e2ee.invitations.length"
    class="encryption-invitations grid gap-2 border-b border-border px-4 py-2.5 text-[13px]"
    data-encryption-invitations
  >
    <div
      v-for="invite in e2ee.invitations"
      :key="invite.groupId"
      class="flex flex-wrap items-center gap-2"
      :data-group-invitation="invite.groupId"
    >
      <AppIcon
        name="lock"
        :size="15"
        class="text-success"
      />
      <span class="min-w-0 flex-1">{{
        t('encryption.group.invitation', { name: invite.inviter, title: invite.title })
      }}</span>
      <UiButton
        size="sm"
        :disabled="!!busy"
        data-group-join
        @click="answer(invite.groupId, true)"
      >
        {{ t('encryption.group.join') }}
      </UiButton>
      <UiButton
        size="sm"
        variant="secondary"
        :disabled="!!busy"
        @click="answer(invite.groupId, false)"
      >
        {{ t('encryption.group.decline') }}
      </UiButton>
    </div>
    <p
      v-if="problem"
      class="m-0 text-destructive"
      role="alert"
    >
      {{ problem }}
    </p>
  </div>
</template>
