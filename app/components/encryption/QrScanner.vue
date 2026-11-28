<script setup lang="ts" vapor>
/**
 * Reads QR codes from the camera with the browser's BarcodeDetector. Browsers without it (Firefox,
 * Chrome on Linux) show why, and the person compares the short code instead.
 */
const emit = defineEmits<{ result: [text: string] }>()
const { t } = useI18n()
type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
const Barcode = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector })
  .BarcodeDetector
const supported = !!Barcode && !!navigator.mediaDevices?.getUserMedia
const video = useTemplateRef<HTMLVideoElement>('video')
const running = ref(false)
const problem = ref('')
let stream: MediaStream | undefined
let timer: ReturnType<typeof setTimeout> | undefined

async function start() {
  problem.value = ''
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    running.value = true
    await nextTick()
    if (!video.value) return stop()
    video.value.srcObject = stream
    await video.value.play()
    const detector = new Barcode!({ formats: ['qr_code'] })
    const scan = async () => {
      if (!running.value || !video.value) return
      try {
        const [found] = await detector.detect(video.value)
        if (found?.rawValue) {
          stop()
          emit('result', found.rawValue)
          return
        }
      } catch {
        // A frame that could not be read; try the next one.
      }
      timer = setTimeout(scan, 250)
    }
    void scan()
  } catch {
    stop()
    problem.value = t('encryption.scanner.denied')
  }
}
function stop() {
  running.value = false
  clearTimeout(timer)
  stream?.getTracks().forEach((track) => track.stop())
  stream = undefined
}
onBeforeUnmount(stop)
</script>
<template>
  <div class="qr-scanner grid gap-2">
    <p
      v-if="!supported"
      class="m-0 text-[13px] text-muted-foreground"
    >
      {{ t('encryption.approval.scanUnavailable') }}
    </p>
    <template v-else>
      <video
        v-if="running"
        ref="video"
        class="aspect-square w-full max-w-64 rounded-md bg-black object-cover"
        muted
        playsinline
        :aria-label="t('encryption.scanner.label')"
      />
      <div>
        <UiButton
          variant="secondary"
          size="sm"
          type="button"
          @click="running ? stop() : start()"
        >
          <AppIcon
            name="camera"
            :size="15"
          />{{ running ? t('encryption.scanner.stop') : t('encryption.scanner.start') }}
        </UiButton>
      </div>
      <p
        v-if="problem"
        class="m-0 text-[13px] text-destructive"
        role="alert"
      >
        {{ problem }}
      </p>
    </template>
  </div>
</template>
