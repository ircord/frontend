<script setup vapor lang="ts">
import { matchingPeople } from '../../../shared/utils/people'

const { t: $t } = useI18n()
const { current, settle } = usePrompt()
const nameStyle = useNameStyle()
const value = ref('')
const input = ref<HTMLInputElement | null>(null)
const picker = ref<{ focus: () => void } | null>(null)
watch(
  current,
  (request) => {
    value.value = request?.value ?? ''
    if (request?.kind === 'prompt')
      nextTick(() => (request.people ? picker.value?.focus() : input.value?.select()))
  },
  { immediate: true },
)
const people = computed(() =>
  current.value?.people
    ? matchingPeople(current.value.people, value.value, current.value.caseMapping, 8)
    : [],
)
const personOptions = computed(() =>
  people.value.map((person) => ({ key: person.id, label: person.nick })),
)
const person = (key: string) => people.value.find((item) => item.id === key)
function choosePerson(key: string) {
  const chosen = person(key)
  if (chosen) value.value = chosen.nick
}
const blocked = computed(
  () =>
    (!!current.value?.requireText && value.value !== current.value.requireText) ||
    (current.value?.kind === 'prompt' &&
      !current.value.requireText &&
      !current.value.allowEmpty &&
      !value.value.trim()),
)
function submit() {
  if (blocked.value) return
  settle(
    current.value?.kind === 'confirm'
      ? ''
      : current.value?.password
        ? value.value
        : value.value.trim(),
  )
}
</script>
<template>
  <AppDialog
    v-if="current"
    :title="current.title"
    @close="settle(null)"
  >
    <form
      class="dialog-form pt-0 pr-5 pb-5 pl-5 [&>.settings-description]:mb-3.5"
      @submit.prevent="submit"
    >
      <SettingsDescription v-if="current.body">
        {{ current.body }}
      </SettingsDescription>
      <AppField
        v-if="current.kind === 'prompt' || current.requireText"
        id="prompt-input"
        class="mt-4"
        :label="
          current.requireText
            ? $t('prompt.typeToConfirm', { text: current.requireText })
            : current.label
        "
      >
        <template #default="control">
          <PeopleCombobox
            v-if="current.people"
            ref="picker"
            v-model="value"
            :options="personOptions"
            :label="current.label ?? ''"
            :placeholder="current.placeholder"
            :described-by="control['aria-describedby']"
            auto-highlight
            @select="choosePerson"
          >
            <template #option="{ option }">
              <span
                v-if="person(option.key)"
                class="flex items-center gap-2.5 [&_.presence]:border-field"
                :data-person="person(option.key)!.nick"
              >
                <UserAvatar
                  :member="person(option.key)!"
                  size="tiny"
                  presence
                />
                <span
                  class="min-w-0 flex-1 truncate text-foreground"
                  :style="nameStyle(person(option.key)!)"
                  >{{ person(option.key)!.displayName || person(option.key)!.nick }}</span
                >
                <span class="shrink-0 text-[length:var(--ui-caption)] text-faint"
                  >@{{ person(option.key)!.nick }}</span
                >
              </span>
            </template>
          </PeopleCombobox>
          <UiInput
            v-else
            v-bind="control"
            :ref="(el) => (input = (el as { $el: HTMLInputElement } | null)?.$el ?? null)"
            v-model="value"
            :placeholder="current.placeholder"
            :type="current.password ? 'password' : 'text'"
            :autocomplete="current.password ? 'current-password' : 'off'"
            autofocus
          />
        </template>
      </AppField>
      <div class="form-actions flex justify-end items-center gap-2 mt-5">
        <UiButton
          variant="secondary"
          type="button"
          @click="settle(null)"
        >
          {{ $t('common.cancel') }}
        </UiButton>
        <UiButton
          :variant="current.danger ? 'destructive' : 'default'"
          :disabled="blocked"
        >
          {{ current.confirm }}
        </UiButton>
      </div>
    </form>
  </AppDialog>
</template>
