<script setup lang="ts">
const { locale } = useI18n()
useHead(() => ({ htmlAttrs: { lang: locale.value } }))
</script>

<template>
  <NuxtLayout name="default"><NuxtPage /></NuxtLayout>
  <!-- One persistent live region for useAnnouncer(): status text that appears with its region
       is often not read, so notices announce here instead of mounting their own. -->
  <NuxtAnnouncer />
</template>
