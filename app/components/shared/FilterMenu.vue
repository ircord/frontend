<script setup vapor lang="ts">
import { selectTriggerClass } from '../ui/select'
import { cn } from '../../utils/cn'
import { nextOption } from '../../utils/option-navigation'
export interface FilterOption {
  value: string
  label: string
  icon?: string
  group?: string
  disabled?: boolean
}

/**
 * A filter dropdown: a select-like button opening a list to pick from, with a search box when the
 * list is long. A string model picks one option and closes; an array model ticks several and stays
 * open, with a way to clear them. Options may be grouped (channels by network).
 */
const props = withDefaults(
  defineProps<{
    options: FilterOption[]
    /** The trigger's text for the current choice. */
    display: string
    label: string
    searchable?: boolean
    searchPlaceholder?: string
    /** Clears an array model ("Any channel"). */
    clearLabel?: string
    note?: string
    /** Fill the row, as a form field does. */
    block?: boolean
  }>(),
  {
    searchable: false,
    searchPlaceholder: undefined,
    clearLabel: undefined,
    note: undefined,
    block: false,
  },
)
const { t } = useI18n()
const model = defineModel<string | string[]>({ required: true })
const open = ref(false)
const query = ref('')
watch(open, (value) => value || (query.value = ''))
const multiple = computed(() => Array.isArray(model.value))
function selected(value: string) {
  return Array.isArray(model.value) ? model.value.includes(value) : model.value === value
}
function choose(option: FilterOption) {
  if (option.disabled) return
  if (Array.isArray(model.value)) {
    model.value = selected(option.value)
      ? model.value.filter((value) => value !== option.value)
      : [...model.value, option.value]
  } else {
    model.value = option.value
    open.value = false
  }
}
const active = computed(() => (multiple.value ? model.value.length > 0 : model.value !== ''))
const shown = computed(() => {
  const q = query.value.trim().toLowerCase().replace(/^#/, '')
  return q ? props.options.filter((o) => o.label.toLowerCase().includes(q)) : props.options
})
const groups = computed(() => {
  const out: { name: string; options: FilterOption[] }[] = []
  for (const option of shown.value) {
    const name = option.group ?? ''
    const group = out.find((g) => g.name === name)
    if (group) group.options.push(option)
    else out.push({ name, options: [option] })
  }
  return out
})
const visibleOptions = computed(() =>
  groups.value.flatMap((group) => group.options).filter((option) => !option.disabled),
)
const current = ref<string>()
const index = computed(() =>
  visibleOptions.value.findIndex((option) => option.value === current.value),
)
const list = ref<HTMLElement | null>(null)
const search = ref<HTMLInputElement | null>(null)
const listId = useId()
const optionId = (value: string) => `${listId}-${encodeURIComponent(value)}`
watch(
  visibleOptions,
  (options) => {
    if (index.value < 0)
      current.value = (options.find((option) => selected(option.value)) ?? options[0])?.value
  },
  { immediate: true },
)
function start(event: Event) {
  event.preventDefault()
  current.value =
    (visibleOptions.value.find((option) => selected(option.value)) ?? visibleOptions.value[0])
      ?.value
  ;(search.value ?? list.value)?.focus({ preventScroll: true })
}
function navigate(event: KeyboardEvent) {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return
  const fromSearch = event.target === search.value
  if (!fromSearch || event.key.startsWith('Arrow')) {
    const next = nextOption(
      event.key,
      visibleOptions.value.map((_, i) => i),
      index.value,
    )
    if (next !== undefined) {
      event.preventDefault()
      current.value = visibleOptions.value[next]!.value
      document.getElementById(optionId(current.value))?.scrollIntoView({ block: 'nearest' })
      return
    }
  }
  if (event.key === 'Enter' || (event.key === ' ' && !fromSearch && event.target === list.value)) {
    const option = visibleOptions.value[index.value]
    if (!option || (event.target instanceof HTMLButtonElement && event.target !== list.value))
      return
    event.preventDefault()
    choose(option)
  }
}
const itemClass =
  'flex min-h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 text-[length:var(--ui-small)] text-body outline-none data-highlighted:bg-accent data-highlighted:text-foreground data-disabled:opacity-45 [@media(pointer:coarse)]:min-h-[44px]'
</script>
<template>
  <UiPopover v-model:open="open">
    <UiPopoverTrigger v-slot="{ bind, setTrigger }">
      <button
        :ref="setTrigger"
        v-bind="bind"
        type="button"
        :class="
          cn(selectTriggerClass, 'filter-menu', block ? 'w-full' : 'w-auto min-w-36 max-w-60')
        "
        :aria-label="t('collectionsUi.filterMenu.triggerLabel', { label, display })"
      >
        <span
          class="min-w-0 flex-1 truncate"
          :class="{ 'text-foreground': active }"
          >{{ display }}</span
        >
        <AppIcon
          name="down"
          :size="15"
          class="shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
        />
      </button>
    </UiPopoverTrigger>
    <UiPopoverContent
      class="p-0"
      :class="block ? 'w-(--panel-trigger-width)' : 'w-64'"
      :aria-label="label"
      @open-auto-focus="start"
    >
      <div
        class="flex max-h-[min(360px,60dvh,var(--panel-available-height,360px))] flex-col"
        @keydown="navigate"
      >
        <div
          v-if="searchable"
          class="search-field-control flex shrink-0 items-center gap-2 border-b [border-bottom-style:solid] border-border/60 px-2.5 text-muted-foreground"
        >
          <AppIcon
            name="search"
            :size="14"
          />
          <input
            ref="search"
            v-model="query"
            role="combobox"
            aria-expanded="true"
            :aria-controls="listId"
            :aria-activedescendant="current === undefined ? undefined : optionId(current)"
            class="h-9 min-w-0 flex-1 border-0 bg-transparent text-[length:var(--ui-small)] text-foreground outline-none placeholder:text-faint [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:text-[length:max(16px,var(--ui-small))]"
            :placeholder="searchPlaceholder ?? t('collectionsUi.filterMenu.search')"
            :aria-label="searchPlaceholder ?? t('collectionsUi.filterMenu.search')"
          />
        </div>
        <div
          :id="listId"
          ref="list"
          role="listbox"
          :aria-label="label"
          tabindex="0"
          :aria-multiselectable="multiple || undefined"
          :aria-activedescendant="current === undefined ? undefined : optionId(current)"
          class="min-h-0 flex-1 overflow-y-auto p-1 outline-none"
        >
          <div
            v-for="group in groups"
            :key="group.name"
            :role="group.name ? 'group' : 'presentation'"
            :aria-label="group.name || undefined"
          >
            <div
              v-if="group.name"
              class="px-2 pt-2 pb-1 text-[length:var(--ui-label)] font-semibold uppercase tracking-[0.02em] text-muted-foreground"
            >
              {{ group.name }}
            </div>
            <button
              v-for="option in group.options"
              :id="optionId(option.value)"
              :key="option.value"
              type="button"
              role="option"
              tabindex="-1"
              :aria-selected="selected(option.value)"
              :data-highlighted="current === option.value ? '' : undefined"
              :data-disabled="option.disabled ? '' : undefined"
              :disabled="option.disabled"
              :class="cn(itemClass, 'w-full text-left')"
              @pointermove="!option.disabled && (current = option.value)"
              @mousedown.prevent
              @click="choose(option)"
            >
              <AppIcon
                v-if="option.icon"
                :name="option.icon"
                :size="14"
                class="shrink-0 text-muted-foreground"
              />
              <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
              <span
                v-if="selected(option.value)"
                class="shrink-0 text-primary"
                ><AppIcon
                  name="check"
                  :size="14"
              /></span>
            </button>
          </div>
          <p
            v-if="!shown.length"
            class="m-0 px-2 py-3 text-center text-[length:var(--ui-small)] text-muted-foreground"
          >
            {{ t('collectionsUi.filterMenu.noMatches', { query }) }}
          </p>
        </div>
        <div
          v-if="note || (multiple && clearLabel)"
          class="flex shrink-0 items-center gap-2 border-t [border-top-style:solid] border-border/60 px-2.5 py-1.5 text-[length:var(--ui-caption)] text-muted-foreground"
        >
          <span class="min-w-0 flex-1">{{ note }}</span>
          <UiButton
            v-if="multiple && clearLabel"
            variant="link"
            size="text"
            class="-mr-1.5 text-[length:var(--ui-caption)]"
            :disabled="!active"
            @click="model = []"
            >{{ clearLabel }}</UiButton
          >
        </div>
      </div>
    </UiPopoverContent>
  </UiPopover>
</template>
