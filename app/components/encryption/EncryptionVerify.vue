<script setup lang="ts" vapor>
/**
 * Verifying one person: their security code as digits and QR code, marking them verified, and
 * scanning their code. Used in a direct chat's encryption panel and for each person of a group.
 */
const props = defineProps<{ peer: string; name: string }>()
const { t } = useI18n()
const e2ee = useE2eeStore()
const code = shallowRef<{ digits: string; qr: string }>()
const scanResult = ref<'match' | 'mismatch' | ''>('')
const scanning = ref(false)
const verified = computed(() => !!e2ee.pins[props.peer]?.verified)

watch(
  () => [props.peer, e2ee.ready] as const,
  async ([peer, ready]) => {
    code.value = undefined
    scanResult.value = ''
    scanning.value = false
    if (peer && ready) code.value = await e2ee.securityCode(peer).catch(() => undefined)
  },
  { immediate: true },
)

async function setVerified(value: boolean) {
  await e2ee.setVerified(props.peer, value)
}

async function scanned(text: string) {
  scanning.value = false
  const match = !!code.value && text.trim() === code.value.qr
  scanResult.value = match ? 'match' : 'mismatch'
  if (match) await setVerified(true)
}

/** The 60 digits in four lines of three groups, as people read them out. */
const codeLines = computed(() => {
  const groups = code.value?.digits.split(' ') ?? []
  return [0, 3, 6, 9].map((i) => groups.slice(i, i + 3).join(' '))
})
</script>
<template>
  <section
    class="grid gap-3 rounded-lg border border-border p-3"
    data-encryption-verify
  >
    <h3 class="m-0 text-[14px] font-[650]">
      {{ t('encryption.dialog.verifyHeading', { name }) }}
    </h3>
    <p
      class="m-0 flex items-center gap-1.5"
      :class="verified ? 'text-success' : 'text-muted-foreground'"
    >
      <AppIcon
        :name="verified ? 'shield' : 'help'"
        :size="14"
      />{{
        verified
          ? t('encryption.dialog.verifiedState', { name })
          : t('encryption.dialog.unverifiedState', { name })
      }}
    </p>
    <p class="m-0 text-muted-foreground">{{ t('encryption.dialog.verifyHelp', { name }) }}</p>
    <div
      v-if="code"
      class="flex flex-wrap items-start gap-4"
    >
      <QrCode
        class="size-32"
        :text="code.qr"
        :label="t('encryption.dialog.verifyHeading', { name })"
      />
      <div
        class="font-code text-[15px] leading-7 tracking-wide tabular-nums"
        data-security-code
      >
        <div
          v-for="(line, i) in codeLines"
          :key="i"
        >
          {{ line }}
        </div>
      </div>
    </div>
    <p
      v-else
      class="m-0 text-muted-foreground"
    >
      {{ t('encryption.dialog.codeFailed') }}
    </p>
    <div class="flex flex-wrap gap-2">
      <UiButton
        v-if="!verified"
        size="sm"
        :disabled="!code"
        @click="setVerified(true)"
      >
        {{ t('encryption.dialog.markVerified') }}
      </UiButton>
      <UiButton
        v-else
        size="sm"
        variant="secondary"
        @click="setVerified(false)"
      >
        {{ t('encryption.dialog.unmarkVerified') }}
      </UiButton>
      <UiButton
        v-if="code && !scanning"
        size="sm"
        variant="secondary"
        @click="scanning = true"
      >
        <AppIcon
          name="qr"
          :size="15"
        />{{ t('encryption.dialog.scan') }}
      </UiButton>
    </div>
    <QrScanner
      v-if="scanning"
      @result="scanned"
    />
    <p
      v-if="scanResult"
      class="m-0"
      :class="scanResult === 'match' ? 'text-success' : 'text-destructive'"
      role="status"
    >
      {{
        scanResult === 'match'
          ? t('encryption.dialog.scanMatch', { name })
          : t('encryption.dialog.scanMismatch', { name })
      }}
    </p>
  </section>
</template>
