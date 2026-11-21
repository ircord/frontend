<script setup vapor lang="ts">
/**
 * One row of a phone sheet (AppSheet): an icon tile, the label, and a hint, a chevron or a check
 * at the end. An unavailable row with a `reason` stays focusable and shows the reason under its
 * label; without one it is disabled. The `icon` slot replaces the tile's icon (a status emoji).
 */
const props = defineProps<{
  label: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  reason?: string
  /** A second line under the label (a message excerpt). */
  detail?: string
  hint?: string
  /** Opens a second page. */
  more?: boolean
  checked?: boolean
}>()
const explained = computed(() => props.disabled && !!props.reason)
</script>
<template>
  <button
    type="button"
    class="sheet-item flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-[length:calc(15px_*_var(--interface-scale,1))] font-[500] active:bg-primary/14 disabled:opacity-45 [&+&]:border-t [&+&]:border-solid [&+&]:border-[color-mix(in_srgb,var(--border)_50%,transparent)]"
    :class="danger ? 'text-destructive active:bg-destructive/14' : 'text-body'"
    :disabled="disabled && !explained"
    :aria-disabled="explained || undefined"
    :aria-pressed="checked"
  >
    <span
      v-if="icon || $slots.icon"
      class="grid size-8 shrink-0 place-items-center rounded-lg"
      :class="danger ? 'bg-destructive/14' : 'bg-foreground/7 text-muted-foreground'"
      aria-hidden="true"
    >
      <slot name="icon"
        ><AppIcon
          :name="icon!"
          :size="17"
      /></slot>
    </span>
    <span
      class="flex min-w-0 flex-1 flex-col"
      :class="{ 'opacity-45': explained }"
    >
      <span class="truncate">{{ label }}</span>
      <span
        v-if="explained || detail"
        class="text-[length:var(--ui-small)] font-[400] text-muted-foreground"
        :class="{ truncate: !explained }"
        >{{ explained ? reason : detail }}</span
      >
    </span>
    <span
      v-if="hint && !explained"
      class="shrink-0 text-[length:var(--ui-small)] text-muted-foreground"
      >{{ hint }}</span
    >
    <AppIcon
      v-if="more"
      name="right"
      :size="16"
      class="shrink-0 text-muted-foreground"
    />
    <AppIcon
      v-else-if="checked"
      name="check"
      :size="18"
      class="shrink-0 text-primary"
    />
  </button>
</template>
