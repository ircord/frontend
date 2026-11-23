<script setup vapor lang="ts">
import type { TableAlign } from '../../../shared/utils/tables'
/** A Markdown table from a message body. Each cell renders as message runs. */
defineProps<{ align: TableAlign[]; header: string[]; rows: string[][] }>()
</script>
<template>
  <div class="message-table-wrap">
    <table class="message-table">
      <thead>
        <tr>
          <th
            v-for="(cell, c) in header"
            :key="c"
            scope="col"
            :style="{ textAlign: align[c] }"
          >
            <MessageRuns :text="cell" />
          </th>
        </tr>
      </thead>
      <tbody v-if="rows.length">
        <tr
          v-for="(row, r) in rows"
          :key="r"
        >
          <td
            v-for="(cell, c) in row"
            :key="c"
            :style="{ textAlign: align[c] }"
          >
            <MessageRuns :text="cell" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
