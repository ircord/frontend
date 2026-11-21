<script setup vapor lang="ts">
import { uploadImageSources } from '../../../shared/utils/upload-image'

const props = defineProps<{ src?: string; width?: string | number; height?: string | number }>()
const source = computed(() => uploadImageSources(props.src, props.width, props.height))
</script>

<template>
  <img
    :width="width"
    :height="height"
    :srcset="source.srcset"
    :src="source.src"
  />
</template>
