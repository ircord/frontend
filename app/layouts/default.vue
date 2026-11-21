<script setup lang="ts" vapor>
import { errorText } from '../utils/api'
const auth = useAuthStore()
const { titleBar } = usePlatform()
const { t } = useI18n()
const $t = t
</script>
<template>
  <div :class="titleBar ? 'desktop-window' : 'contents'">
    <DesktopTitleBar v-if="titleBar" />
    <AppWorkspace v-if="auth.status === 'signed-in'"><slot /></AppWorkspace>
    <LoginScreen v-else-if="auth.status === 'signed-out'" />
    <BootScreen
      v-else-if="auth.status === 'error'"
      :title="$t('app.couldNotReach')"
      :detail="errorText(auth.session.error, (key) => t(key))"
      @retry="auth.session.refetch()"
    />
    <BootScreen v-else />
  </div>
</template>
