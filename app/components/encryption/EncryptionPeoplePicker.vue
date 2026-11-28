<script setup lang="ts" vapor>
/**
 * People for an encrypted group, by account. Suggests people you have direct messages with, then
 * people from shared channels, then the network search; an account name that matches nobody can
 * still be added. People who cannot take part show why, with the reasons the direct-message lock
 * uses.
 */
import type { Conversation, Member } from '../../../shared/types/chat'
import { sameAccount } from '../../../shared/e2ee/group'
import {
  groupCandidates,
  typedAccounts,
  type GroupCandidate,
  type KnownPerson,
} from '../../../shared/e2ee/people'
import type { StartBlocker } from '../../../shared/e2ee/start'
import { networkPeople } from '../../../shared/utils/people'

const people = defineModel<string[]>({ required: true })
const query = defineModel<string>('query', { required: true })
/** Whether someone chosen cannot take part. */
const blocked = defineModel<boolean>('blocked', { default: false })
const { t } = useI18n()
const chat = useChatStore()
const e2ee = useE2eeStore()
const auth = useAuthStore()
const home = computed(() => e2ee.homeNetwork?.id ?? '')
const lookup = usePeopleLookup(() => ({ networkId: home.value, purpose: 'services', limit: 20 }))

const known = (m: Member): KnownPerson => ({
  nick: m.nick,
  displayName: m.displayName,
  account: m.account,
  role: m.role,
  avatarUrl: m.avatarUrl,
  avatarSrc: m.avatarSrc,
  color: m.color,
})
const direct = computed(() =>
  (chat.data?.conversations ?? [])
    .filter((c: Conversation) => c.networkId === home.value && c.kind === 'direct' && !c.party)
    .map((c) => chat.directPartner(c))
    .filter((m): m is Member => !!m && m.id !== 'you')
    .map(known),
)
const channel = computed(() =>
  networkPeople(chat.data?.members ?? [], chat.data?.conversations ?? [], home.value).map(known),
)
const candidates = computed(() =>
  groupCandidates({
    query: query.value,
    direct: direct.value,
    channel: channel.value,
    found: (lookup.state.value.page?.items ?? []).filter(
      (p) => !p.backendAccountId || p.backendAccountId !== auth.account?.id,
    ),
    exclude: [...people.value, e2ee.account],
  }),
)

/** What chosen people look like, as found when they were added. */
const chosen = reactive<Record<string, GroupCandidate>>({})
/** Reasons that keep a person out. Without keys, a person is invited and joins later. */
const stops: StartBlocker[] = ['bot', 'peerAccount', 'peerNoAnswer']
const later: StartBlocker[] = ['peerNoKeys', 'peerNoKeysAcross']
/** Why a person cannot take part, or undefined when they can (as far as this client knows). */
function blocker(account: string, bot: boolean) {
  const found = e2ee.accountBlocker(account, bot)
  return found && stops.includes(found) ? found : undefined
}
const waits = (account: string) => {
  const found = e2ee.accountBlocker(account)
  return !!found && later.includes(found)
}
const reason = (account: string, bot: boolean, name: string) => {
  const found = blocker(account, bot)
  return found ? t(`encryption.blocked.${found}`, { name }) : ''
}
const chips = computed(() =>
  people.value.map((account) => {
    const seen = chosen[account.toLowerCase()]
    const name = seen?.name ?? account
    return {
      account,
      name,
      seen,
      reason: reason(account, !!seen?.bot, name),
      waits: waits(account),
    }
  }),
)
watchEffect(() => (blocked.value = chips.value.some((chip) => chip.reason)))

/** Keys are looked up once per account while the dialog is open. */
const checked = new Set<string>()
function checkKeys(accounts: string[]) {
  for (const account of accounts) {
    const key = account.toLowerCase()
    if (!account || checked.has(key)) continue
    checked.add(key)
    void e2ee.checkPeerKeys(account)
  }
}
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => candidates.value.filter((c) => !c.bot).map((c) => c.account),
  (accounts) => {
    clearTimeout(timer)
    timer = setTimeout(() => checkKeys(accounts), 300)
  },
)
onBeforeUnmount(() => clearTimeout(timer))

const typed = computed(() =>
  typedAccounts(query.value).filter(
    (name) =>
      !people.value.some((p) => sameAccount(p, name)) &&
      !sameAccount(name, e2ee.account) &&
      !candidates.value.some((c) => sameAccount(c.account, name)),
  ),
)
const options = computed(() => {
  const exact = candidates.value.filter((c) =>
    typedAccounts(query.value).some((name) => sameAccount(c.account, name)),
  )
  const rest = candidates.value.filter((c) => !exact.includes(c))
  const suggestions = [...exact, ...rest].map((c) => ({
    key: c.key,
    label: c.name,
    disabled: !c.account || !!blocker(c.account, c.bot),
  }))
  const literal = typed.value.length
    ? [{ key: 'typed', label: typed.value.join(', '), disabled: false }]
    : []
  // An exact account wins; otherwise suggestions complete what was typed, and the typed text is
  // the last choice.
  return suggestions.length ? [...suggestions, ...literal] : literal
})
const candidate = (key: string) => candidates.value.find((c) => c.key === key)
function detail(c: GroupCandidate) {
  if (!c.account) return t('encryption.blocked.peerAccount', { name: c.name })
  const why = reason(c.account, c.bot, c.name)
  if (why) return why
  const who = c.nick && !sameAccount(c.nick, c.account) ? `${c.account} · @${c.nick}` : c.account
  return waits(c.account) ? `${who} · ${t('encryption.group.waitsForKeysShort')}` : who
}
/** Where each chosen person gets the message that they were invited: their nick. */
defineExpose({
  nicks: () =>
    Object.fromEntries(
      people.value.map((account) => [
        account.toLowerCase(),
        chosen[account.toLowerCase()]?.nick || account,
      ]),
    ),
})

function add(account: string, seen?: GroupCandidate) {
  if (people.value.some((p) => sameAccount(p, account))) return
  if (seen) chosen[account.toLowerCase()] = seen
  people.value = [...people.value, account]
  checkKeys([account])
}
function select(key: string) {
  if (key === 'typed') for (const name of typed.value) add(name)
  else {
    const c = candidate(key)
    if (c?.account) add(c.account, c)
  }
  query.value = ''
}
function remove(account: string) {
  people.value = people.value.filter((p) => p !== account)
}
function keydown(event: KeyboardEvent) {
  const target = event.target as HTMLInputElement | null
  if (
    event.key === 'Backspace' &&
    target?.getAttribute('role') === 'combobox' &&
    !target.value &&
    target.selectionStart === 0 &&
    people.value.length
  )
    remove(people.value.at(-1)!)
}
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <div
    class="grid gap-1.5"
    data-group-people
    @keydown="keydown"
  >
    <ul
      v-if="chips.length"
      class="m-0 flex list-none flex-wrap gap-1.5 p-0"
      :aria-label="t('encryption.group.chosen')"
      data-group-chosen
    >
      <li
        v-for="chip in chips"
        :key="chip.account"
        class="flex items-center gap-1.5 rounded-md bg-secondary py-0.5 pl-1 text-[length:var(--ui-small)]"
        :class="{
          'text-warning': chip.reason,
          'text-muted-foreground': !chip.reason && chip.waits,
        }"
        :title="chip.reason || chip.account"
        :data-chip-blocked="chip.reason ? '' : undefined"
        :data-chip-waits="!chip.reason && chip.waits ? '' : undefined"
      >
        <UserAvatar
          :member="{
            displayName: chip.name,
            avatarUrl: chip.seen?.avatarUrl,
            avatarSrc: chip.seen?.avatarSrc,
            color: chip.seen?.color,
            role: chip.seen?.bot ? 'bot' : undefined,
          }"
          size="tiny"
        />
        <span>{{ chip.name }}</span>
        <AppIcon
          v-if="chip.reason"
          name="shieldAlert"
          :size="13"
        />
        <AppIcon
          v-else-if="chip.waits"
          name="clock"
          :size="13"
        />
        <UiButton
          type="button"
          variant="ghost"
          size="icon-sm"
          :aria-label="t('encryption.group.removeChosen', { name: chip.name })"
          @click="remove(chip.account)"
          ><AppIcon
            name="close"
            :size="13"
        /></UiButton>
      </li>
    </ul>
    <ul
      v-if="chips.some((chip) => chip.reason || chip.waits)"
      class="m-0 grid list-none gap-0.5 p-0"
      role="status"
      data-group-notes
    >
      <template
        v-for="chip in chips"
        :key="chip.account"
        ><li
          v-if="chip.reason"
          class="text-warning"
          data-group-blocked
        >
          {{ chip.reason }}
        </li>
        <li
          v-else-if="chip.waits"
          class="text-muted-foreground"
          data-group-waits
        >
          {{ t('encryption.group.waitsForKeys', { name: chip.name }) }}
        </li></template
      >
    </ul>
    <PeopleCombobox
      v-model="query"
      :options="options"
      :label="t('encryption.group.findPeople')"
      :placeholder="t('encryption.group.searchPlaceholder')"
      auto-highlight
      prevent-submit
      @search="lookup.search"
      @select="select"
    >
      <template #option="{ option }">
        <span
          v-if="candidate(option.key)"
          class="flex min-w-0 items-center gap-2.5"
          :data-person-account="candidate(option.key)!.account"
        >
          <UserAvatar
            :member="{
              displayName: candidate(option.key)!.name,
              avatarUrl: candidate(option.key)!.avatarUrl,
              avatarSrc: candidate(option.key)!.avatarSrc,
              color: candidate(option.key)!.color,
              role: candidate(option.key)!.bot ? 'bot' : undefined,
            }"
            size="small"
          />
          <span class="grid min-w-0">
            <span class="truncate font-medium">{{ option.label }}</span>
            <span
              class="truncate text-[length:var(--ui-caption)]"
              :class="option.disabled ? 'text-warning' : 'text-muted-foreground'"
              :data-person-waits="
                !option.disabled && waits(candidate(option.key)!.account) ? '' : undefined
              "
              >{{ detail(candidate(option.key)!) }}</span
            >
          </span>
        </span>
        <span
          v-else
          class="flex items-center gap-2.5"
          data-person-typed
        >
          <AppIcon
            name="plus"
            :size="15"
            class="mx-1.5"
          />
          <span>{{ t('encryption.group.addTyped', { name: option.label }) }}</span>
        </span>
      </template>
      <template #default="{ open }">
        <p
          v-if="open && lookup.state.value.loading && !options.length"
          class="m-0 text-[length:var(--ui-small)] text-muted-foreground"
          role="status"
        >
          {{ t('encryption.group.searching') }}
        </p>
        <FieldHint
          v-else-if="
            open && (lookup.state.value.error || lookup.state.value.page?.status === 'unavailable')
          "
          >{{ t('encryption.group.searchUnavailable') }}</FieldHint
        >
      </template>
    </PeopleCombobox>
  </div>
</template>
