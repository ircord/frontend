<script setup vapor lang="ts">
import type { MessageList } from '../../../shared/utils/lists'
/** A Markdown list from a message body, nested lists included. Text renders as message runs. */
defineProps<{ list: MessageList }>()
const { t } = useI18n()
</script>
<template>
  <component
    :is="list.ordered ? 'ol' : 'ul'"
    class="message-list block my-0.5 mx-0 pl-[1.6em] [list-style:disc]"
    :start="list.ordered && list.start !== 1 ? list.start : undefined"
  >
    <li
      v-for="(item, index) in list.items"
      :key="index"
      :class="{ 'message-task': item.checked !== undefined }"
    >
      <input
        v-if="item.checked !== undefined"
        type="checkbox"
        class="message-task-box"
        :checked="item.checked"
        disabled
        :aria-label="
          t(item.checked ? 'workspaceUi.controls.taskDone' : 'workspaceUi.controls.taskTodo')
        "
      />
      <MessageRuns :text="item.text" />
      <MessageListBlock
        v-for="(child, c) in item.children"
        :key="c"
        :list="child"
      />
    </li>
  </component>
</template>
