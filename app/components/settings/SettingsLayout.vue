<script setup vapor lang="ts">
import type { SettingsPages } from '../../composables/settings/useSettingsPages'
/**
 * The frame of a settings-style dialog: a section list beside the content, with an optional
 * field above the list. On phones (`pages`, from useSettingsPages) it shows one page at a time:
 * the list with its field, or one section.
 */
withDefaults(defineProps<{ label: string; pages?: SettingsPages; searching?: boolean }>(), {
  pages: undefined,
  searching: false,
})
</script>
<template>
  <div
    class="settings-layout grid min-h-0 flex-1 [grid-template-areas:'search_content'_'nav_content'] [grid-template-columns:calc(200px_*_var(--interface-scale,1))_minmax(0,_1fr)] [grid-template-rows:auto_minmax(0,_1fr)] max-[700px]:[grid-template-areas:'search'_'nav'_'content'] max-[700px]:[grid-template-columns:1fr] max-[700px]:[grid-template-rows:auto_auto_minmax(0,_1fr)]"
    :data-view="pages?.view"
    :data-moved="pages?.moved || undefined"
    :data-searching="searching || undefined"
  >
    <slot name="search" />
    <nav
      class="settings-nav flex flex-col gap-0.5 overflow-y-auto bg-sidebar px-2 py-3 [grid-area:nav] max-[700px]:flex-row max-[700px]:overflow-x-auto max-[700px]:p-2"
      :aria-label="label"
    >
      <slot name="nav" />
    </nav>
    <slot />
  </div>
</template>
<style>
/* Phones: the list (with search, or its results) or one section, never both. */
@media (max-width: 700px) {
  .settings-layout[data-view='list'] {
    grid-template-areas: 'search' 'nav';
    grid-template-rows: auto minmax(0, 1fr);
  }
  .settings-layout[data-view='list'] > .settings-content,
  .settings-layout[data-view='list']:not([data-searching]) > .settings-results {
    display: none;
  }
  .settings-layout[data-view='list'][data-searching] {
    grid-template-areas: 'search' 'content';
  }
  .settings-layout[data-view='list'][data-searching] > .settings-nav {
    display: none;
  }
  .settings-layout[data-view='list'] > .settings-search {
    padding: 4px 12px 8px;
    background: transparent;
  }
  .settings-layout[data-view='list'] .settings-search > svg {
    left: 24px;
  }
  /* The list reads top to bottom: group headings over cards of rows. */
  .settings-layout[data-view='list'] > .settings-nav {
    flex-direction: column;
    gap: 2px;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 4px 12px 24px;
    background: transparent;
  }
  .settings-layout[data-view='list'] .settings-nav-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 12px;
  }
  .settings-layout[data-view='list'] .settings-nav-group {
    padding: 8px 12px 6px;
  }
  .settings-layout[data-view='section'] {
    grid-template-areas: 'content';
    grid-template-rows: minmax(0, 1fr);
  }
  .settings-layout[data-view='section'] > :is(.settings-search, .settings-nav, .settings-results) {
    display: none;
  }
  .settings-layout[data-view='section'] > .settings-content {
    padding: 12px 16px 24px;
  }
  /* A section comes in from the side it was chosen from, and the list returns from the other. */
  .settings-layout[data-moved][data-view='section'] > .settings-content {
    animation: settings-page-in 0.2s ease-out;
  }
  .settings-layout[data-moved][data-view='list'] > .settings-nav {
    animation: settings-list-in 0.2s ease-out;
  }
}
@keyframes settings-page-in {
  from {
    opacity: 0;
    transform: translateX(32px);
  }
}
@keyframes settings-list-in {
  from {
    opacity: 0;
    transform: translateX(-32px);
  }
}
:root[data-motion='reduced'] .settings-layout > * {
  animation: none !important;
}
</style>
