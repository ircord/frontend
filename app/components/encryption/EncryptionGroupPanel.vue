<script setup lang="ts" vapor>
import type { Conversation } from '../../../shared/types/chat'
import { isGroupAdmin, sameAccount } from '../../../shared/e2ee/group'
/**
 * An encrypted group's details: who is in it with their devices and whether you verified them,
 * the people in its channel who are not in the encrypted group, and for the creator and admins
 * adding and removing people and appointing admins. Members leave here; the creator hands the
 * group over or closes it. The trust caveat says what a group's safety rests on.
 */
const props = defineProps<{ conversation: Conversation }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const chat = useChatStore()
const e2ee = useE2eeStore()
const prompt = usePrompt()
const record = computed(() => e2ee.groupOf(props.conversation.id))
const view = computed(() => (record.value ? e2ee.groups[record.value.groupId] : undefined))
const title = computed(() => view.value?.title || record.value?.title || props.conversation.name)
const self = computed(() => e2ee.account)
const admin = computed(() => isGroupAdmin(view.value, self.value))
const creator = computed(() => !!view.value && sameAccount(view.value.creator, self.value))
const lock = computed(() => e2ee.groupLockFor(props.conversation.id))
const busy = ref('')
const problem = ref('')
const verifying = ref('')
const adding = ref('')

/** The nick a member shows in this channel, or their account. */
function nickOf(person: string) {
  const id = e2ee.memberIdFor(props.conversation.id, person)
  return (id && chat.member(id, props.conversation.networkId)?.nick) || person
}
const changed = (person: string) => e2ee.notices.find((n) => sameAccount(n.account, person))
const people = computed(() =>
  (view.value?.members ?? []).map((m) => ({
    ...m,
    you: sameAccount(m.account, self.value),
    nick: nickOf(m.account),
    creator: !!view.value && sameAccount(view.value.creator, m.account),
    admin: !!view.value && view.value.admins.some((a) => sameAccount(a, m.account)),
    verified: !!e2ee.pins[m.account]?.verified,
    fresh: !!changed(m.account),
  })),
)
/** People in the channel whose account is not in the encrypted group. */
const outside = computed(() => {
  const members = view.value?.members ?? []
  return (props.conversation.memberIds ?? [])
    .map((id) => chat.member(id, props.conversation.networkId))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .filter((m) => m.id !== 'you' && !members.some((x) => sameAccount(x.account, m.account)))
})
const freshNotices = computed(() =>
  e2ee.notices.filter((n) => people.value.some((p) => !p.you && sameAccount(p.account, n.account))),
)

async function run(key: string, action: () => Promise<unknown>) {
  busy.value = key
  problem.value = ''
  try {
    await action()
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = ''
  }
}

const add = () =>
  run('add', async () => {
    const names = adding.value.split(/[\s,]+/).filter(Boolean)
    await e2ee.addPeople(props.conversation.id, names)
    adding.value = ''
  })

async function remove(person: string) {
  const ok = await prompt.confirm({
    title: t('encryption.group.removeTitle', { name: nickOf(person) }),
    body: t('encryption.group.removeBody', { name: nickOf(person) }),
    confirm: t('encryption.group.remove'),
    danger: true,
  })
  if (ok) await run(`remove:${person}`, () => e2ee.removePerson(props.conversation.id, person))
}

async function leave(close: boolean) {
  const ok = await prompt.confirm({
    title: t(close ? 'encryption.group.closeTitle' : 'encryption.group.leaveTitle', {
      title: title.value,
    }),
    body: t(close ? 'encryption.group.closeBody' : 'encryption.group.leaveBody'),
    confirm: t(close ? 'encryption.group.close' : 'encryption.group.leave'),
    danger: true,
  })
  if (!ok) return
  await run('leave', async () => {
    await e2ee.leaveGroup(props.conversation.id, close)
    emit('close')
  })
}
</script>
<template>
  <AppDialog
    :title="title"
    @close="emit('close')"
  >
    <div
      class="encryption-group grid gap-4 pt-0 pr-5 pb-5 pl-5 text-[13px] text-body"
      data-encryption-group
    >
      <p class="m-0 flex items-center gap-2">
        <UiBadge variant="secondary">{{ t('encryption.experimental') }}</UiBadge>
        <span class="text-muted-foreground">{{ t('encryption.experimentalHelp') }}</span>
      </p>

      <p
        class="m-0 flex items-center gap-2"
        :class="lock.state === 'attention' ? 'text-warning' : 'text-success'"
        data-group-lock
      >
        <AppIcon
          :name="lock.state === 'attention' ? 'shieldAlert' : 'lock'"
          :size="15"
        />{{
          lock.state === 'verified'
            ? t('encryption.group.lockVerified')
            : lock.state === 'attention'
              ? t('encryption.group.lockAttention')
              : t('encryption.group.lockOn', { verified: lock.verified, total: lock.total })
        }}
      </p>

      <p
        v-if="record && e2ee.fellOut[record.groupId]"
        class="m-0 rounded-md border border-warning/40 bg-warning/10 px-3 py-2"
        role="status"
      >
        {{
          e2ee.fellOut[record.groupId] === 'asking'
            ? t('encryption.group.fellOut')
            : t('encryption.group.fellOutFailed')
        }}
      </p>
      <p
        v-else-if="!view"
        class="m-0 text-muted-foreground"
      >
        {{ t('encryption.group.notMember') }}
      </p>

      <div
        v-for="notice in freshNotices"
        :key="notice.id"
        class="grid gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2"
        data-group-fresh
      >
        <p class="m-0">
          {{ t('encryption.group.startedFresh', { name: nickOf(notice.account) }) }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UiButton
            v-if="admin"
            size="sm"
            :disabled="!!busy"
            @click="run('fresh', () => e2ee.letBackIn(conversation.id, notice.account))"
          >
            {{ t('encryption.group.letBackIn', { name: nickOf(notice.account) }) }}
          </UiButton>
          <UiButton
            v-if="admin"
            size="sm"
            variant="secondary"
            :disabled="!!busy"
            @click="remove(notice.account)"
          >
            {{ t('encryption.group.removeFresh', { name: nickOf(notice.account) }) }}
          </UiButton>
          <UiButton
            size="sm"
            variant="ghost"
            @click="e2ee.acceptReset(notice)"
          >
            {{ t('encryption.reset.ok') }}
          </UiButton>
        </div>
      </div>

      <section
        v-if="view"
        class="grid gap-2"
      >
        <h3 class="m-0 text-[14px] font-[650]">
          {{ t('encryption.group.people', { count: people.length }) }}
        </h3>
        <ul
          class="m-0 grid list-none gap-1 p-0"
          data-group-members
        >
          <li
            v-for="p in people"
            :key="p.account"
            class="grid gap-1 rounded-md border border-border px-3 py-2"
            :data-group-member="p.account"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-[600]">{{ p.you ? t('encryption.group.you') : p.nick }}</span>
              <span
                v-if="!p.you && p.nick !== p.account"
                class="text-muted-foreground"
                >{{ p.account }}</span
              >
              <UiBadge
                v-if="p.creator"
                variant="secondary"
                >{{ t('encryption.group.creator') }}</UiBadge
              >
              <UiBadge
                v-else-if="p.admin"
                variant="secondary"
                >{{ t('encryption.group.admin') }}</UiBadge
              >
              <span
                v-if="!p.you"
                class="ml-auto flex items-center gap-1"
                :class="
                  p.fresh ? 'text-warning' : p.verified ? 'text-success' : 'text-muted-foreground'
                "
              >
                <AppIcon
                  :name="p.fresh ? 'shieldAlert' : p.verified ? 'shield' : 'help'"
                  :size="13"
                />{{
                  p.fresh
                    ? t('encryption.group.freshState')
                    : p.verified
                      ? t('encryption.group.verified')
                      : t('encryption.group.notVerified')
                }}
              </span>
            </div>
            <ul class="m-0 list-none p-0 text-[12px] text-muted-foreground">
              <li
                v-for="d in p.devices"
                :key="d"
                :data-group-device="d"
              >
                {{
                  p.you && d === e2ee.info.deviceId
                    ? t('encryption.group.thisDevice')
                    : t('encryption.group.device', { id: d.slice(0, 8) })
                }}
              </li>
            </ul>
            <div
              v-if="!p.you"
              class="flex flex-wrap gap-1.5"
            >
              <UiButton
                size="sm"
                variant="secondary"
                @click="verifying = verifying === p.account ? '' : p.account"
              >
                {{ t('encryption.group.verify') }}
              </UiButton>
              <template v-if="admin">
                <UiButton
                  v-if="!p.creator"
                  size="sm"
                  variant="ghost"
                  :disabled="!!busy"
                  @click="
                    run(`admin:${p.account}`, () =>
                      e2ee.setAdmin(conversation.id, p.account, !p.admin),
                    )
                  "
                >
                  {{
                    p.admin ? t('encryption.group.removeAdmin') : t('encryption.group.makeAdmin')
                  }}
                </UiButton>
                <UiButton
                  v-if="creator"
                  size="sm"
                  variant="ghost"
                  :disabled="!!busy"
                  @click="run(`hand:${p.account}`, () => e2ee.handOver(conversation.id, p.account))"
                >
                  {{ t('encryption.group.handOver') }}
                </UiButton>
                <UiButton
                  v-if="!p.creator"
                  size="sm"
                  variant="ghost"
                  class="text-destructive"
                  :disabled="!!busy"
                  @click="remove(p.account)"
                >
                  {{ t('encryption.group.remove') }}
                </UiButton>
              </template>
            </div>
            <EncryptionVerify
              v-if="verifying === p.account"
              :peer="p.account"
              :name="p.nick"
            />
          </li>
        </ul>
      </section>

      <section
        v-if="outside.length"
        class="grid gap-1"
        data-group-outside
      >
        <h3 class="m-0 text-[14px] font-[650]">{{ t('encryption.group.notInGroup') }}</h3>
        <p class="m-0 text-muted-foreground">{{ t('encryption.group.notInGroupHelp') }}</p>
        <ul class="m-0 list-none p-0">
          <li
            v-for="m in outside"
            :key="m.id"
          >
            {{ m.nick }}
          </li>
        </ul>
      </section>

      <form
        v-if="view && admin"
        class="flex gap-2"
        @submit.prevent="add"
      >
        <UiInput
          v-model="adding"
          class="min-w-0 flex-1"
          :placeholder="t('encryption.group.addPlaceholder')"
          :aria-label="t('encryption.group.addPeople')"
          data-group-add
        />
        <UiButton
          type="submit"
          :disabled="!adding.trim() || !!busy"
        >
          {{ busy === 'add' ? t('encryption.group.adding') : t('encryption.group.addPeople') }}
        </UiButton>
      </form>

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
          <p class="m-0">{{ t('encryption.group.trust') }}</p>
          <p class="m-0 text-muted-foreground">{{ t('encryption.webLimit') }}</p>
        </div>
      </div>

      <p
        v-if="problem"
        class="m-0 text-destructive"
        role="alert"
      >
        {{ problem }}
      </p>

      <div class="form-actions mt-1 flex flex-wrap items-center justify-end gap-2">
        <UiButton
          v-if="creator"
          variant="destructive"
          :disabled="!!busy"
          @click="leave(true)"
        >
          {{ t('encryption.group.close') }}
        </UiButton>
        <UiButton
          v-else
          variant="destructive"
          :disabled="!!busy"
          data-group-leave
          @click="leave(false)"
        >
          {{ t('encryption.group.leave') }}
        </UiButton>
      </div>
    </div>
  </AppDialog>
</template>
