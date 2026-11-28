<script setup lang="ts" vapor>
import { parseApprovalQr } from '../../../shared/e2ee/codec'
import type { PendingApproval } from '../../stores/e2ee'
/**
 * Settings → Encryption: this device's encryption state, approving devices in both directions,
 * the account's devices, and starting fresh. Shown only when the server offers encryption.
 */
const { t } = useI18n()
const { day } = useTimeFormat()
const e2ee = useE2eeStore()
const prompt = usePrompt()

const stateText = computed(() => {
  switch (e2ee.phase) {
    case 'off':
      return t('encryption.settings.state.off')
    case 'unsupported':
      return t('encryption.settings.state.unsupported')
    case 'starting':
      return t('encryption.settings.state.starting')
    case 'waiting':
      return t('encryption.settings.state.waiting')
    case 'needs-approval':
      return t('encryption.settings.state.needsApproval')
    case 'reset-elsewhere':
      return t('encryption.settings.state.resetElsewhere')
    case 'failed':
      return t('encryption.settings.state.failed', { reason: e2ee.failure })
    default:
      return e2ee.info.holdsIdentity
        ? t('encryption.settings.state.readyIdentity')
        : t('encryption.settings.state.ready')
  }
})

// ---- This device asks for approval ------------------------------------------------------------

const request = shallowRef<{ qr: string; code: string; cancel: () => void }>()
const requestProblem = ref('')
const approvedHere = ref(false)
async function askApproval() {
  requestProblem.value = ''
  try {
    request.value = await e2ee.requestApproval(() => {
      request.value = undefined
      approvedHere.value = true
    })
  } catch (error) {
    requestProblem.value = error instanceof Error ? error.message : String(error)
  }
}
function cancelRequest() {
  request.value?.cancel()
  request.value = undefined
}
onBeforeUnmount(() => request.value?.cancel())

// ---- This device approves another ---------------------------------------------------------------

const pending = ref<PendingApproval[]>([])
const approving = ref(false)
const approveStatus = ref('')
const approveProblem = ref('')
let pendingTimer: ReturnType<typeof setInterval> | undefined
const canApprove = computed(() => e2ee.ready && !!e2ee.info.holdsIdentity)
async function refreshPending() {
  if (!canApprove.value || approving.value) return
  pending.value = await e2ee.pendingApprovals().catch(() => [])
}
watch(
  canApprove,
  (on) => {
    clearInterval(pendingTimer)
    if (!on) return
    void refreshPending()
    pendingTimer = setInterval(() => void refreshPending(), 3000)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearInterval(pendingTimer))

async function approve(item: PendingApproval, secret?: Uint8Array) {
  approving.value = true
  approveProblem.value = ''
  approveStatus.value = t('encryption.approval.approving')
  try {
    await e2ee.approve(item, secret)
    approveStatus.value = t('encryption.approval.done')
    pending.value = pending.value.filter((p) => p.id !== item.id)
  } catch (error) {
    approveStatus.value = ''
    approveProblem.value = t('encryption.approval.failed', {
      reason: error instanceof Error ? error.message : String(error),
    })
  } finally {
    approving.value = false
  }
}
const scanning = ref(false)
async function scanned(text: string) {
  scanning.value = false
  const code = parseApprovalQr(text)
  await refreshPending()
  const item =
    code && pending.value.find((p) => p.deviceId === code.deviceId && p.digest === code.digest)
  if (!code || !item) {
    approveProblem.value = t('encryption.approval.notFound')
    return
  }
  approveStatus.value = t('encryption.approval.scanned')
  await approve(item, code.secret)
}

// ---- Devices and starting fresh -----------------------------------------------------------------

const devices = computed(() => e2ee.directory?.devices ?? [])
async function remove(device: { deviceId: string; label?: string }) {
  const name = device.label || device.deviceId.slice(0, 8)
  if (
    !(await prompt.confirm({
      title: t('encryption.settings.removeTitle', { name }),
      body: t('encryption.settings.removeBody'),
      confirm: t('encryption.settings.remove'),
      danger: true,
    }))
  )
    return
  await e2ee.removeDevice(device.deviceId).catch(() => {})
}
async function startFresh() {
  if (
    !(await prompt.confirm({
      title: t('encryption.settings.startFreshTitle'),
      body: t('encryption.settings.startFreshBody'),
      confirm: t('encryption.settings.startFreshConfirm'),
      danger: true,
    }))
  )
    return
  cancelRequest()
  await e2ee.startFresh()
}
</script>

<template>
  <div
    class="encryption-settings grid gap-6"
    data-encryption-settings
  >
    <div class="grid gap-2 text-[13px]">
      <p class="m-0 flex flex-wrap items-center gap-2">
        <UiBadge variant="secondary">{{ t('encryption.experimental') }}</UiBadge>
        <span>{{ t('encryption.settings.intro') }}</span>
      </p>
      <p class="m-0 text-muted-foreground">{{ t('encryption.experimentalHelp') }}</p>
      <div
        class="flex gap-2.5 rounded-md border border-border bg-card px-3 py-2.5"
        data-encryption-limits
      >
        <AppIcon
          name="shieldAlert"
          :size="16"
          class="mt-0.5 shrink-0 text-warning"
        />
        <div class="grid gap-1.5">
          <p class="m-0">{{ t('encryption.webLimit') }}</p>
          <p class="m-0">{{ t('encryption.storageLimit') }}</p>
          <p class="m-0 text-muted-foreground">{{ t('encryption.trustYou') }}</p>
        </div>
      </div>
    </div>

    <SettingGroup :title="t('encryption.settings.thisDevice')">
      <p
        class="m-0 flex items-center gap-2 text-[13px]"
        :class="e2ee.ready ? 'text-success' : 'text-body'"
        data-encryption-phase
        :data-phase="e2ee.phase"
      >
        <AppIcon
          :name="e2ee.ready ? 'lock' : 'lockOpen'"
          :size="15"
        />{{ stateText }}
      </p>
      <p
        v-if="e2ee.ready && devices.length <= 1"
        class="m-0 text-[13px] text-muted-foreground"
      >
        {{ t('encryption.settings.secondDevice') }}
      </p>
      <template v-if="e2ee.phase === 'needs-approval' || e2ee.phase === 'reset-elsewhere'">
        <div
          v-if="request"
          class="grid gap-3"
          data-encryption-request
        >
          <h4 class="m-0 text-[14px] font-[650]">{{ t('encryption.approval.requestTitle') }}</h4>
          <p class="m-0 text-[13px] text-muted-foreground">
            {{ t('encryption.approval.requestHelp') }}
          </p>
          <QrCode
            class="size-44"
            :text="request.qr"
            :label="t('encryption.approval.requestTitle')"
          />
          <p class="m-0 text-[13px]">
            {{ t('encryption.approval.noCamera') }}
            <strong
              class="font-code text-[16px] tracking-wider tabular-nums"
              data-approval-code
              >{{ request.code }}</strong
            >
          </p>
          <p
            class="m-0 text-[13px] text-muted-foreground"
            role="status"
          >
            {{ t('encryption.approval.waiting') }}
          </p>
          <div>
            <UiButton
              variant="secondary"
              size="sm"
              @click="cancelRequest"
            >
              {{ t('encryption.approval.cancel') }}
            </UiButton>
          </div>
        </div>
        <div
          v-else
          class="flex flex-wrap gap-2"
        >
          <UiButton
            data-encryption-ask-approval
            @click="askApproval"
          >
            <AppIcon
              name="qr"
              :size="15"
            />{{ t('encryption.banner.approveAction') }}
          </UiButton>
        </div>
        <p
          v-if="requestProblem"
          class="m-0 text-[13px] text-destructive"
          role="alert"
        >
          {{ requestProblem }}
        </p>
      </template>
      <p
        v-if="approvedHere"
        class="m-0 text-[13px] text-success"
        role="status"
      >
        {{ t('encryption.approval.approved') }}
      </p>
    </SettingGroup>

    <SettingGroup
      v-if="e2ee.ready"
      :title="t('encryption.settings.approveDevice')"
    >
      <template v-if="canApprove">
        <p class="m-0 text-[13px] text-muted-foreground">
          {{ t('encryption.settings.approveHelp') }}
        </p>
        <QrScanner
          v-if="scanning"
          @result="scanned"
        />
        <div v-else>
          <UiButton
            size="sm"
            :disabled="approving"
            @click="scanning = true"
          >
            <AppIcon
              name="qr"
              :size="15"
            />{{ t('encryption.approval.scanTitle') }}
          </UiButton>
        </div>
        <div
          class="grid gap-2"
          data-encryption-pending
        >
          <strong class="text-[13px]">{{ t('encryption.approval.pending') }}</strong>
          <p
            v-if="!pending.length"
            class="m-0 text-[13px] text-muted-foreground"
          >
            {{ t('encryption.approval.pendingNone') }}
          </p>
          <div
            v-for="item in pending"
            :key="item.id"
            class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
          >
            <span class="font-code text-[15px] tracking-wider tabular-nums">{{
              t('encryption.approval.pendingCode', { code: item.code })
            }}</span>
            <UiButton
              size="sm"
              :disabled="approving"
              @click="approve(item)"
            >
              {{ t('encryption.approval.approveThis') }}
            </UiButton>
          </div>
        </div>
      </template>
      <p
        v-else
        class="m-0 text-[13px] text-muted-foreground"
      >
        {{ t('encryption.settings.approveNeedsIdentity') }}
      </p>
      <p
        v-if="approveStatus"
        class="m-0 text-[13px]"
        role="status"
      >
        {{ approveStatus }}
      </p>
      <p
        v-if="approveProblem"
        class="m-0 text-[13px] text-destructive"
        role="alert"
      >
        {{ approveProblem }}
      </p>
    </SettingGroup>

    <SettingGroup
      v-if="devices.length"
      :title="t('encryption.settings.devices')"
    >
      <p class="m-0 text-[13px] text-muted-foreground">
        {{ t('encryption.settings.devicesHelp') }}
      </p>
      <ul
        class="m-0 grid list-none gap-2 p-0"
        data-encryption-devices
      >
        <li
          v-for="device in devices"
          :key="device.deviceId"
          class="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[13px]"
        >
          <span class="grid min-w-0">
            <strong class="truncate">{{ device.label || device.deviceId.slice(0, 8) }}</strong>
            <small class="text-muted-foreground">
              <template v-if="device.deviceId === e2ee.info.deviceId"
                >{{ t('encryption.settings.current') }} ·
              </template>
              {{ t('encryption.settings.added', { date: day(device.createdAt) }) }}
            </small>
          </span>
          <UiButton
            v-if="device.deviceId !== e2ee.info.deviceId && e2ee.ready"
            size="sm"
            variant="secondary"
            @click="remove(device)"
          >
            {{ t('encryption.settings.remove') }}
          </UiButton>
        </li>
      </ul>
    </SettingGroup>

    <SettingGroup
      v-if="
        e2ee.phase === 'ready' ||
        e2ee.phase === 'needs-approval' ||
        e2ee.phase === 'reset-elsewhere'
      "
      :title="t('encryption.settings.startFresh')"
    >
      <SettingRow
        :label="t('encryption.settings.startFresh')"
        :description="t('encryption.settings.startFreshHelp')"
      >
        <UiButton
          variant="destructive"
          size="sm"
          data-encryption-start-fresh
          @click="startFresh"
        >
          {{ t('encryption.settings.startFreshConfirm') }}
        </UiButton>
      </SettingRow>
    </SettingGroup>
  </div>
</template>
