// Busy-channel performance run. Needs a demo-mode server:
//   bun run build && NUXT_DEMO=true PORT=4174 bun run preview
//   bun scripts/perf-busy.mjs             (BASE=http://127.0.0.1:4174 by default)
//   CHROME_CHANNEL=chrome bun scripts/perf-busy.mjs  (installed Google Chrome)
// Load is configurable: MEMBERS, HISTORY, RATE, CHURN, SECONDS, plus FLOOD (seconds measured).
// Set EMBEDS=1 for local images, videos and link cards. This defaults to quiet history so live
// traffic doesn't replace the seeded media rows. The video fixture uses FFmpeg.
// PASSES controls the number of history scrolls in each direction (default 2 with embeds).
// PROFILE can match a scenario label to report its hottest JavaScript functions.
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.BASE ?? 'http://127.0.0.1:4174'
const withEmbeds = process.env.EMBEDS === '1'
const load = {
  members: Number(process.env.MEMBERS ?? 5000),
  history: Number(process.env.HISTORY ?? 5000),
  rate: Number(process.env.RATE ?? (withEmbeds ? 0 : 20)),
  churn: Number(process.env.CHURN ?? (withEmbeds ? 0 : 10)),
  seconds: Number(process.env.SECONDS ?? 120),
}
const flood = Number(process.env.FLOOD ?? (withEmbeds ? 1 : 15))
const passes = Number(process.env.PASSES ?? (withEmbeds ? 2 : 1))
const profiles = []
const mediaRequests = { image: 0, video: 0, card: 0 }
let fixturePages = 0

const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL,
  args: ['--enable-precise-memory-info'],
})
console.log('Browser', browser.version())
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
})
const cdp = await page.context().newCDPSession(page)
const browserCDP = await browser.newBrowserCDPSession()
await cdp.send('Performance.enable')
await cdp.send('Network.enable')
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

async function metrics() {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
}
async function rendererRSS() {
  if (process.platform === 'win32') return undefined
  const { processInfo } = await browserCDP.send('SystemInfo.getProcessInfo')
  const pids = processInfo
    .filter((process) => process.type === 'renderer')
    .map((process) => process.id)
  if (!pids.length) return undefined
  const result = spawnSync('ps', ['-o', 'rss=', '-p', pids.join(',')], { encoding: 'utf8' })
  if (result.status !== 0) return undefined
  return Math.round(
    result.stdout
      .trim()
      .split(/\s+/)
      .reduce((sum, value) => sum + Number(value), 0) / 1024,
  )
}

async function addMediaFixtures() {
  const fixture = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=640x360:r=15:d=2',
    '-an',
    '-c:v',
    'libvpx',
    '-deadline',
    'realtime',
    '-f',
    'webm',
    'pipe:1',
  ])
  if (fixture.status !== 0)
    throw new Error(fixture.stderr?.toString() || 'Could not make the video fixture')
  const image = await readFile(new URL('../public/icons/icon-512.png', import.meta.url))
  await page.route(`${base}/__perf_media/*`, async (route) => {
    const video = route.request().url().endsWith('.webm')
    mediaRequests[video ? 'video' : 'image']++
    const bytes = video ? fixture.stdout : image
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = range ? Number(range[1]) : 0
    const end = range && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1
    await route.fulfill({
      status: range ? 206 : 200,
      headers: {
        'Content-Type': video ? 'video/webm' : 'image/png',
        'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
      },
      body: bytes.subarray(start, end + 1),
    })
  })
  await page.route('**/api/v1/bootstrap**', async (route) => {
    const response = await route.fetch()
    if (!response.ok()) return route.fulfill({ response })
    const bootstrap = await response.json()
    const channel = bootstrap.conversations.find((conversation) => conversation.id === 'busy')
    if (channel) channel.channelSettings = { ...channel.channelSettings, nsfw: false }
    await route.fulfill({ response, json: bootstrap })
  })
  await page.route('**/api/v1/conversations/busy/messages?*', async (route) => {
    const response = await route.fetch()
    if (!response.ok()) return route.fulfill({ response })
    const history = await response.json()
    fixturePages++
    for (const message of history.items) {
      const kind = Math.floor(Date.parse(message.createdAt) / 2000) % 8
      if (kind > 2 || !Number.isFinite(kind)) continue
      if (kind === 2) {
        message.text = `Link preview fixture https://example.invalid/posts/${message.id}`
        continue
      }
      const video = kind === 0
      const name = video ? 'fixture.webm' : 'fixture.png'
      message.text = video ? 'Video preview fixture' : 'Image preview fixture'
      message.attachments = [
        {
          name,
          url: `${base}/__perf_media/${message.id}-${name}`,
          contentType: video ? 'video/webm' : 'image/png',
          width: video ? 640 : 512,
          height: video ? 360 : 512,
        },
      ]
    }
    await route.fulfill({ response, json: history })
  })
  await page.route('**/conversations/busy/messages/*/link-media', (route) => {
    const { url } = route.request().postDataJSON()
    if (!url?.startsWith('https://example.invalid/posts/')) return route.continue()
    mediaRequests.card++
    return route.fulfill({
      json: {
        url,
        kind: 'card',
        provider: 'page',
        assets: [],
        card: {
          site: 'Example fixture',
          title: 'A local preview without an image',
          description: 'A metadata preview with generated artwork.',
        },
      },
    })
  })
}
/** Collects frame times and long tasks in the page while `run` executes. */
async function measure(label, run) {
  const profiling = process.env.PROFILE && label.includes(process.env.PROFILE)
  if (profiling) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')
  }
  await page.evaluate(() => {
    const w = window
    w.__perf = { frames: [], long: [] }
    let last = performance.now()
    const loop = (t) => {
      w.__perf.frames.push(t - last)
      last = t
      if (w.__perf) w.__perf.raf = requestAnimationFrame(loop)
    }
    w.__perf.raf = requestAnimationFrame(loop)
    w.__perf.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__perf.long.push(entry.duration)
    })
    w.__perf.observer.observe({ type: 'longtask' })
  })
  const before = await metrics()
  const started = Date.now()
  await run()
  const elapsed = (Date.now() - started) / 1000
  const after = await metrics()
  if (profiling) {
    const { profile } = await cdp.send('Profiler.stop')
    profiles.push({
      scenario: label,
      functions: profile.nodes
        .filter((node) => node.hitCount && node.callFrame.url)
        .sort((a, b) => b.hitCount - a.hitCount)
        .slice(0, 15)
        .map(({ callFrame, hitCount }) => ({
          function: callFrame.functionName,
          samples: hitCount,
          source: `${callFrame.url}:${callFrame.lineNumber + 1}:${callFrame.columnNumber + 1}`,
        })),
    })
  }
  const sample = await page.evaluate(() => {
    const w = window
    cancelAnimationFrame(w.__perf.raf)
    w.__perf.observer.disconnect()
    const result = { frames: w.__perf.frames.slice(1), long: w.__perf.long }
    w.__perf = undefined
    return result
  })
  const frames = sample.frames.sort((a, b) => a - b)
  const at = (q) => frames[Math.min(frames.length - 1, Math.floor(q * frames.length))] ?? 0
  const delta = (key) => (after[key] - before[key]) * 1000
  const row = {
    scenario: label,
    seconds: +elapsed.toFixed(1),
    fps: +(frames.length / elapsed).toFixed(1),
    'frame p50': +at(0.5).toFixed(1),
    'frame p95': +at(0.95).toFixed(1),
    'frame max': +(frames.at(-1) ?? 0).toFixed(0),
    'frames >50ms': frames.filter((f) => f > 50).length,
    'long tasks': sample.long.length,
    'long ms': Math.round(sample.long.reduce((a, b) => a + b, 0)),
    'script ms': Math.round(delta('ScriptDuration')),
    'layout ms': Math.round(delta('LayoutDuration')),
    'style ms': Math.round(delta('RecalcStyleDuration')),
    'heap MB': +(after.JSHeapUsedSize / 1048576).toFixed(1),
    nodes: after.Nodes,
  }
  results.push(row)
  return row
}
const results = []

// ---- Sign in and create the busy channel ------------------------------------------------------
const demoProbe = await page.request.post(`${base}/api/v1/_demo/busy`, { data: { stop: true } })
if (demoProbe.status() !== 401)
  throw new Error('Start a demo-mode frontend before running this benchmark')
await page.goto(base)
await page.getByRole('button', { name: 'Create an account' }).click()
const username = `perf${Date.now().toString(36)}`
await page.getByLabel('Username', { exact: true }).fill(username)
await page
  .locator('#signup-username-help')
  .filter({ hasText: `${username} is available` })
  .waitFor()
await page.getByLabel('Password', { exact: true }).fill('perf-test-password')
await page.getByRole('button', { name: 'Create account', exact: true }).click()
await page.getByRole('textbox', { name: 'Message #general' }).waitFor()
const started = await page.request.post(`${base}/api/v1/_demo/busy`, { data: load })
if (!started.ok()) throw new Error(`Could not seed the busy channel (${started.status()})`)
console.log('load', await started.json())
if (withEmbeds) await addMediaFixtures()
const conversation = (name) =>
  page.locator('.conversation-link').filter({ has: page.getByText(name, { exact: true }) })
const busyLink = conversation('busy')
const firstMessage = page
  .locator('.timeline-row')
  .filter({ has: page.locator('.message-row') })
  .first()

// Authenticated startup with an empty HTTP cache, including the large roster in bootstrap.
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
let t = Date.now()
await page.reload({ waitUntil: 'domcontentloaded' })
await busyLink.waitFor({ timeout: 30_000 })
await page.getByRole('textbox', { name: 'Message #general' }).waitFor()
await firstMessage.waitFor()
await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length)
const startup = {
  readyMs: Date.now() - t,
  ...(await page.evaluate(() => {
    const scripts = performance
      .getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).pathname.endsWith('.js'))
    return {
      firstContentfulPaintMs: Math.round(
        performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0,
      ),
      scriptRequests: scripts.length,
      scriptKiB: Math.round(scripts.reduce((sum, entry) => sum + entry.encodedBodySize, 0) / 1024),
    }
  })),
}
await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })

// ---- Opening the channel -----------------------------------------------------------------------
t = Date.now()
await busyLink.click()
await page.getByRole('textbox', { name: 'Message #busy' }).waitFor()
await page.locator('.message-row').first().waitFor()
const openMs = Date.now() - t

// ---- Sitting at the bottom while the flood arrives ---------------------------------------------
await measure(`flood ${load.rate}/s, churn ${load.churn}/s`, () =>
  page.waitForTimeout(flood * 1000),
)
const heapAfterFlood = (await metrics()).JSHeapUsedSize

// ---- Revisiting history and releasing its players ------------------------------------------------
async function scrollHistory(direction) {
  await page.mouse.move(800, 400)
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, direction * 3000)
    await page.waitForTimeout(120)
  }
}
const historySamples = []
for (let pass = 1; pass <= passes; pass++) {
  await measure(`history up ${pass}`, () => scrollHistory(-1))
  await cdp.send('HeapProfiler.collectGarbage')
  const settled = await metrics()
  historySamples.push({
    heapMB: +(settled.JSHeapUsedSize / 1048576).toFixed(1),
    nodes: settled.Nodes,
    rendererRSS: await rendererRSS(),
    players: await page.locator('.timeline-scroll video, .timeline-scroll iframe').count(),
  })
  await measure(`history down ${pass}`, () => scrollHistory(1))
}
const rows = await page.locator('.message-row').count()
if (withEmbeds && Object.values(mediaRequests).some((count) => count === 0)) {
  const blocked = await page.locator('.timeline-scroll .sensitive-media').count()
  throw new Error(
    `The history workload did not exercise every media fixture (${fixturePages} pages, ${blocked} sensitive previews): ${JSON.stringify(mediaRequests)}`,
  )
}

// ---- Member list -------------------------------------------------------------------------------
const memberScroller = page.locator('.members-scroll')
if (!(await memberScroller.isVisible())) await page.locator('.member-toggle').click()
const box = await memberScroller.boundingBox()
if (!box) throw new Error('Could not open the member list')
const memberRows = page.locator('.member-sidebar .member-button')
await memberRows.first().waitFor()
const visibleMembers = await memberRows.count()
if (load.members > visibleMembers)
  await measure('scroll members', async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 4000)
      await page.waitForTimeout(60)
    }
    if (!(await memberScroller.evaluate((element) => element.scrollTop)))
      throw new Error('The roster did not scroll')
  })
const filter = page.locator('.members-filter input, input.members-filter')
if (await filter.isVisible())
  await measure('filter members', async () => {
    await filter.fill('user00000')
    await memberRows.filter({ hasText: 'User 0' }).waitFor()
    if ((await memberRows.count()) !== 1)
      throw new Error('The roster filter did not narrow the list')
    await filter.clear()
    await memberRows.nth(1).waitFor()
  })

// ---- Switching away and back -------------------------------------------------------------------
const switches = []
await measure('switch channels', async () => {
  for (const name of ['general', 'busy', 'general', 'busy', 'general', 'busy']) {
    const previous = await firstMessage.getAttribute('data-message-id')
    const start = Date.now()
    await conversation(name).first().click()
    await page.getByRole('textbox', { name: `Message #${name}` }).waitFor()
    await page.waitForFunction((previous) => {
      const first = document.querySelector('.timeline-row:has(.message-row)')
      return first && first.getAttribute('data-message-id') !== previous
    }, previous)
    switches.push({ name, ms: Date.now() - start })
  }
})

// ---- Idle after the flood (memory should settle) ------------------------------------------------
await page.request.post(`${base}/api/v1/_demo/busy`, { data: { stop: true } })
await page.waitForTimeout(1000)
await cdp.send('HeapProfiler.collectGarbage')
const settled = await metrics()

console.table(results)
console.log({
  startup,
  'open #busy ms': openMs,
  switches,
  'message rows in DOM': rows,
  'member rows in DOM': visibleMembers,
  'heap after flood MB': +(heapAfterFlood / 1048576).toFixed(1),
  historySamples,
  ...(withEmbeds ? { 'fixture media requests': mediaRequests } : {}),
  'heap after GC MB': +(settled.JSHeapUsedSize / 1048576).toFixed(1),
  'DOM nodes': settled.Nodes,
  'page errors': errors,
})
for (const { scenario, functions } of profiles) {
  console.log(scenario)
  console.table(functions)
}
await browser.close()
if (errors.length) process.exitCode = 1
