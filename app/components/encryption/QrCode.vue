<script setup lang="ts" vapor>
import { encode } from 'uqr'
/** A QR code drawn as one SVG path, dark on light whatever the theme, so cameras can read it. */
const props = defineProps<{ text: string; label: string }>()
const code = computed(() => {
  const { data, size } = encode(props.text, { ecc: 'M', border: 2 })
  let path = ''
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`
    }),
  )
  return { path, size }
})
</script>
<template>
  <svg
    class="qr-code block rounded-md bg-white"
    :viewBox="`0 0 ${code.size} ${code.size}`"
    role="img"
    :aria-label="label"
    shape-rendering="crispEdges"
  >
    <path
      :d="code.path"
      fill="#000"
    />
  </svg>
</template>
