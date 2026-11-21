<script setup vapor lang="ts" generic="T extends string | number">
import type { ClassValue } from 'clsx'
import { cn } from '../../utils/cn'
import { nextOption } from '../../utils/option-navigation'
import { selectTriggerClass } from '../ui/select'
/**
 * A select-only combobox: a button showing the current choice and a listbox popup
 * portalled above dialogs and scroll containers. On touch screens the native select is used
 * instead, which the platform presents better.
 *
 * Attributes such as `id`, `aria-label` and `aria-describedby` go to the button (or the
 * native select), so `<label for>` and AppField work as with any form control.
 */
export interface SelectOption<V> {
  value: V
  label: string
  disabled?: boolean
  /** A heading the option is listed under; consecutive options with one group share it. */
  group?: string
}
defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    options: readonly SelectOption<T>[]
    placeholder?: string
    disabled?: boolean
    invalid?: boolean
    /** Forces the native select (or the custom popup), instead of choosing by pointer type. */
    native?: boolean | null
  }>(),
  { placeholder: undefined, disabled: false, invalid: false, native: null },
)
const { t } = useI18n()
const model = defineModel<T | null>({ default: null })
const emit = defineEmits<{ change: [value: T] }>()
const attrs = useAttrs()
// Utility overrides from callers must win over the primitive's defaults. Forward all other
// native attributes unchanged; Vue's normal class concatenation cannot resolve utility clashes.
const controlAttrs = () => {
  const { class: _class, ...native } = attrs
  return native
}

const coarse = import.meta.client && window.matchMedia?.('(pointer: coarse)').matches
const useNative = computed(() => props.native ?? !!coarse)

// A field's error (aria-invalid from AppField) counts as invalid too.
const isInvalid = computed(
  () => props.invalid || attrs['aria-invalid'] === true || attrs['aria-invalid'] === 'true',
)
const selectedIndex = computed(() => props.options.findIndex((o) => o.value === model.value))
const placeholderText = computed(() => props.placeholder ?? t('common.choose'))

function choose(index: number) {
  const option = props.options[index]
  if (!option || option.disabled) return
  // Picking the current value again is not a change.
  if (option.value === model.value) return
  model.value = option.value
  emit('change', option.value)
}
// Track positions separately so empty strings and numbers can both be selected.
const open = ref(false)
const active = ref(-1)
const list = ref<HTMLElement | null>(null)
const enabled = computed(() =>
  props.options.flatMap((option, index) => (option.disabled ? [] : [index])),
)
function highlight(index: number) {
  active.value = index
  const item = list.value?.querySelector<HTMLElement>(`[data-option="${index}"]`)
  item?.scrollIntoView({ block: 'nearest' })
}
function pick(index: number) {
  if (props.options[index]?.disabled) return
  choose(index)
  open.value = false
}
function focusList(event: Event) {
  event.preventDefault()
  list.value?.focus({ preventScroll: true })
  highlight(
    enabled.value.includes(selectedIndex.value) ? selectedIndex.value : (enabled.value[0] ?? -1),
  )
}
let search = ''
let typedAt = 0
function navigate(event: KeyboardEvent) {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return
  const index = nextOption(event.key, enabled.value, active.value)
  if (index !== undefined) {
    event.preventDefault()
    highlight(index)
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (active.value >= 0) pick(active.value)
  } else if (event.key.length === 1) {
    const now = performance.now()
    search = (now - typedAt < 500 ? search : '') + event.key.toLowerCase()
    typedAt = now
    const found = enabled.value.find((index) =>
      props.options[index]?.label.toLowerCase().startsWith(search),
    )
    if (found !== undefined) highlight(found)
  }
}
function openWithArrow(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  open.value = true
}
const optionId = (index: number) => `${listId}-option-${index}`
const listId = useId()
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) open.value = false
  },
)
/** Runs of options under one heading (one unnamed run when no option has a group). */
const sections = computed(() => {
  const out: { name: string; options: { option: SelectOption<T>; index: number }[] }[] = []
  props.options.forEach((option, index) => {
    const name = option.group ?? ''
    const last = out.at(-1)
    if (last && last.name === name) last.options.push({ option, index })
    else out.push({ name, options: [{ option, index }] })
  })
  return out
})
function onNativeChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  choose(props.options.findIndex((o) => String(o.value) === value))
}
</script>

<template>
  <select
    v-if="useNative"
    v-bind="controlAttrs()"
    :class="[
      cn('app-select-native control-input max-[700px]:text-[16px]', attrs.class as ClassValue),
      { invalid: isInvalid },
    ]"
    :disabled="disabled"
    :aria-invalid="isInvalid || undefined"
    @change="onNativeChange"
  >
    <option
      v-if="model == null"
      value=""
      disabled
      selected
    >
      {{ placeholderText }}
    </option>
    <template
      v-for="(section, s) in sections"
      :key="s"
    >
      <optgroup
        v-if="section.name"
        :label="section.name"
      >
        <option
          v-for="{ option, index } in section.options"
          :key="index"
          :value="String(option.value)"
          :selected="option.value === model"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </option>
      </optgroup>
      <template v-else>
        <option
          v-for="{ option, index } in section.options"
          :key="index"
          :value="String(option.value)"
          :selected="option.value === model"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </option>
      </template>
    </template>
  </select>
  <UiPopover
    v-else
    v-model:open="open"
  >
    <UiPopoverTrigger v-slot="{ bind, setTrigger }">
      <button
        :ref="setTrigger"
        v-bind="{ ...controlAttrs(), ...bind }"
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        :aria-controls="open ? listId : undefined"
        :disabled="disabled"
        :class="cn(selectTriggerClass, 'app-select', attrs.class as ClassValue)"
        :aria-invalid="isInvalid || undefined"
        @keydown="openWithArrow"
      >
        <span
          class="app-select-value flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
          :class="{ 'text-faint': selectedIndex < 0 }"
          >{{ options[selectedIndex]?.label ?? placeholderText }}</span
        >
        <AppIcon
          name="down"
          :size="15"
          class="app-select-chevron shrink-0 text-muted-foreground [transition:transform_0.15s] group-data-[state=open]:rotate-180"
        />
      </button>
    </UiPopoverTrigger>
    <UiPopoverContent
      role="presentation"
      class="app-select-list w-auto min-w-[var(--panel-trigger-width)] max-w-[min(420px,calc(100vw_-_16px))] border border-solid border-border bg-secondary p-0"
      @open-auto-focus="focusList"
    >
      <div
        :id="listId"
        ref="list"
        role="listbox"
        tabindex="-1"
        class="max-h-[min(320px,var(--panel-available-height,320px))] overflow-y-auto p-1 outline-none"
        :aria-label="typeof attrs['aria-label'] === 'string' ? attrs['aria-label'] : undefined"
        :aria-activedescendant="active >= 0 ? optionId(active) : undefined"
        @keydown="navigate"
        @keydown.tab.prevent
      >
        <template
          v-for="(section, s) in sections"
          :key="s"
        >
          <div
            :role="section.name ? 'group' : 'presentation'"
            :aria-label="section.name || undefined"
          >
            <div
              v-if="section.name"
              class="app-select-group px-2 pt-2 pb-1 text-[length:var(--ui-caption)] font-[550] text-muted-foreground"
            >
              {{ section.name }}
            </div>
            <button
              v-for="{ option, index } in section.options"
              :id="optionId(index)"
              :key="index"
              :data-option="index"
              type="button"
              role="option"
              tabindex="-1"
              :aria-selected="index === selectedIndex"
              :disabled="option.disabled"
              :data-highlighted="active === index ? '' : undefined"
              class="app-select-option flex min-h-8 w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-[length:var(--ui-small)] outline-none data-highlighted:bg-accent disabled:opacity-45"
              @pointermove="!option.disabled && (active = index)"
              @click="pick(index)"
            >
              {{ option.label }}
              <AppIcon
                v-if="index === selectedIndex"
                name="check"
                :size="14"
                class="shrink-0 text-primary"
              />
            </button>
          </div>
        </template>
      </div>
    </UiPopoverContent>
  </UiPopover>
</template>
