// Uses the disposable backend and Ergo provided by TestErgoOutboxBrowser.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const fixture = JSON.parse(process.env.IRCORD_OUTBOX_TEST)
const frontend = spawn(process.execPath, ['.output/server/index.mjs'], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(fixture.port),
    NUXT_DEMO: 'false',
    NUXT_BACKEND_URL: fixture.api,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
frontend.stdout.on('data', (chunk) => {
  serverLog = (serverLog + chunk).slice(-3000)
})
frontend.stderr.on('data', (chunk) => {
  serverLog = (serverLog + chunk).slice(-3000)
})
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(fixture.ui)).ok) break
    } catch {
      // Wait for the disposable frontend to listen.
    }
    assert(attempt < 100 && frontend.exitCode === null, 'Outbox frontend did not start')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
  })
  const login = await context.request.post(`${fixture.ui}/api/v1/auth/login`, {
    data: { username: fixture.username, password: fixture.password },
  })
  assert.equal(login.status(), 200)
  const page = await context.newPage()
  page.setDefaultTimeout(12_000)
  const errors = []
  page.on('pageerror', (error) => {
    // Same known offline-worker CSP result as the workspace browser check.
    if (
      error.message.includes('WebAssembly.instantiate()') &&
      error.message.includes('violates the following Content Security policy directive')
    )
      return
    errors.push(error.message)
  })
  const missing = 'Saved without an IRC receipt'
  const browserOnly = 'Preserve this message when the browser never reaches Go'
  const sendPath = `**/api/v1/conversations/${fixture.conversation}/messages`
  let blocked = true
  const attempts = new Set()
  await page.route(sendPath, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = route.request().postDataJSON()
    if (body.text !== browserOnly) return route.continue()
    attempts.add(body.clientId)
    if (blocked) await route.abort('failed')
    else await route.continue()
  })

  await page.goto(fixture.ui)
  const composer = page.locator('.composer-field')
  const channel = page
    .locator('.conversation-sidebar')
    .getByText(fixture.room.slice(1), { exact: true })
  if (!(await composer.isVisible())) await channel.click()
  await composer.waitFor()
  await page.getByText(missing, { exact: true }).waitFor()
  const uncertain = page.locator('.message-row').filter({ hasText: missing })
  await uncertain.getByRole('button', { name: 'Check delivery' }).waitFor()
  await uncertain.getByRole('button', { name: 'Send again' }).click()
  await page
    .getByRole('dialog')
    .getByText(/can create a duplicate/)
    .waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })

  const nextPoll = (timeout) =>
    page.waitForRequest(
      (request) =>
        request.method() === 'GET' && new URL(request.url()).pathname === '/api/v1/outbox',
      { timeout },
    )
  const firstPoll = nextPoll(8_000)
  await composer.fill(browserOnly)
  await composer.press('Enter')
  await page.getByText(browserOnly, { exact: true }).waitFor()
  assert.equal(await composer.textContent(), '')
  await firstPoll
  const firstPollAt = performance.now()
  await nextPoll(12_000)
  assert(performance.now() - firstPollAt >= 7_000, 'unchanged delivery should slow polling')

  const pollAfterNewSend = nextPoll(7_000)
  await composer.fill('A new send resets delivery checks')
  await composer.press('Enter')
  await pollAfterNewSend
  const pollAfterReconnect = nextPoll(3_000)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await pollAfterReconnect

  await page.reload()
  await page.getByText(browserOnly, { exact: true }).waitFor()
  await page.getByText(missing, { exact: true }).waitFor()
  assert.equal(attempts.size, 1)
  const [id] = attempts
  const posted = page.waitForResponse(
    (response) => {
      if (
        !response.url().endsWith(`/api/v1/conversations/${fixture.conversation}/messages`) ||
        response.request().method() !== 'POST' ||
        response.status() !== 202
      )
        return false
      return response.request().postDataJSON().clientId === id
    },
    { timeout: 16_000 },
  )
  blocked = false
  await posted
  await page.waitForFunction(
    async ([base, clientId]) => {
      const result = await fetch(`${base}/api/v1/commands/${clientId}`)
      return result.ok && (await result.json()).state === 'sent'
    },
    [fixture.ui, id],
  )
  assert.equal(await page.getByText(browserOnly, { exact: true }).count(), 1)
  assert.equal(attempts.size, 1)
  assert.deepEqual(errors, [])
  await page.setViewportSize({ width: 390, height: 844 })
  await uncertain.getByRole('button', { name: 'Check delivery' }).waitFor()
  const actions = await uncertain.getByRole('button', { name: 'Remove from outbox' }).boundingBox()
  assert(actions && actions.x >= 0 && actions.x + actions.width <= 390)
  console.log(
    'Outbox preserved a lost HTTP send across reload and recovered one IRC-confirmed message. The unknown send and its duplicate warning remained available.',
  )
  console.log('Unchanged delivery slowed polling. A new send and reconnect brought checks forward.')
} catch (error) {
  console.error(serverLog)
  throw error
} finally {
  await browser?.close()
  frontend.kill()
}
