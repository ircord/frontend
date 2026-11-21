<script setup lang="ts" vapor>
const { serverOrigin, chooseServer } = usePlatform()
const { t } = useI18n()
const failed = ref(false)
const host = serverOrigin ? new URL(serverOrigin).host : ''
async function changeServer() {
  failed.value = false
  try {
    await chooseServer?.()
  } catch {
    failed.value = true
  }
}
</script>

<template>
  <div v-if="chooseServer" class="flex w-full flex-wrap items-center justify-center gap-x-2 border-t border-border pt-3 text-[13px] text-muted-foreground">
    <span v-if="host" class="min-w-0 break-all">{{ host }}</span>
    <UiButton variant="link" size="text" type="button" @click="changeServer">
      {{ t('app.chooseDesktopServer') }}
    </UiButton>
    <p v-if="failed" role="alert" class="w-full text-danger">
      {{ t('app.chooseDesktopServerFailed') }}
    </p>
  </div>
</template>
