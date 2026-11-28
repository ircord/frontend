// Browser checks for Administration → Encryption against the demo build, with the owner-only
// administration endpoints mocked: the mode switches between Off and Experimental, a mode the
// server configuration fixes is read-only with its reason, a lock that appears after loading
// shows at once, and a failed load offers a retry. Run `bun run build`, then
// `bun run preview:demo`, and point IRCORD_UI_URL at it. Screenshots go to IRCORD_SHOT_DIR
// (default ../.data).
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.env.IRCORD_UI_URL ?? 'http://127.0.0.1:4173'
const shotDir = process.env.IRCORD_SHOT_DIR ?? resolve(process.cwd(), '..', '.data')
mkdirSync(shotDir, { recursive: true })

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

const lockReason = 'IRCORD_E2EE is set in the server environment.'

async function open(browser, state, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
  await context.route('**/api/v1/administration/**', async (route) => {
    const req = route.request()
    const { pathname } = new URL(req.url())
    if (pathname === '/api/v1/administration/access') return json(route, { owner: true })
    if (pathname === '/api/v1/administration/encryption' && req.method() === 'GET') {
      if (state.failGets > 0) {
        state.failGets--
        return json(route, { status: 503, detail: 'Try again.' }, 503)
      }
      return json(route, state.setting)
    }
    if (pathname === '/api/v1/administration/encryption' && req.method() === 'PUT') {
      state.puts.push(req.postDataJSON())
      if (state.lockOnPut) {
        state.setting = { mode: state.setting.mode, locked: true, lockReason }
        return json(route, { status: 409, detail: lockReason }, 409)
      }
      state.setting = {
        mode: req.postDataJSON().mode,
        locked: false,
        updatedAt: '2026-11-28T09:30:00Z',
        updatedBy: 'veteran',
      }
      return json(route, state.setting)
    }
    return json(route, {})
  })
  // A disposable demo account; the mocked access check makes it an owner.
  const signup = await context.request.post(`${url}/api/v1/auth/signup`, {
    data: { username: `owner${Date.now().toString(36)}`, password: 'correct horse battery staple' },
  })
  assert(signup.ok(), `demo signup failed: ${signup.status()}`)
  const page = await context.newPage()
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/v1/bootstrap')
      state.snapshots = (state.snapshots ?? 0) + 1
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Administration' }).click()
  const admin = page.getByRole('dialog', { name: 'Administration' })
  await admin.getByRole('button', { name: 'Encryption' }).click()
  // On phones the dialog takes the section's title, so later checks look inside the section.
  const section = page.locator('.admin-encryption')
  await section.waitFor()
  return { context, page, admin: section }
}

const radio = (admin, name) => admin.getByRole('radio', { name })

const browser = await chromium.launch()
try {
  console.log('Checking an unlocked mode switches both ways')
  {
    const state = { setting: { mode: 'off', locked: false }, puts: [] }
    const { context, page, admin } = await open(browser, state)
    await radio(admin, 'Off').waitFor()
    assert(await radio(admin, 'Off').isChecked(), 'Off starts checked')
    assert(await radio(admin, 'Experimental').isEnabled(), 'Experimental can be chosen')
    await admin.getByText('Turning it off deletes nothing.', { exact: false }).waitFor()
    const before = state.snapshots ?? 0
    await radio(admin, 'Experimental').click()
    await admin.getByText('Encrypted direct messages are on (experimental).').waitFor()
    // This client rereads its snapshot so it picks up the new encryption capability.
    await page
      .waitForRequest((r) => new URL(r.url()).pathname === '/api/v1/bootstrap', {
        timeout: 10_000,
      })
      .catch(() => {})
    assert((state.snapshots ?? 0) > before, 'saving refreshes the snapshot')
    assert(state.puts.at(-1)?.mode === 'experimental', 'PUT sends experimental')
    assert(await radio(admin, 'Experimental').isChecked(), 'Experimental is checked after saving')
    await page.screenshot({ path: resolve(shotDir, 'admin-encryption-unlocked.png') })
    await radio(admin, 'Off').click()
    await admin.getByText('Encrypted direct messages are off.').waitFor()
    assert(state.puts.at(-1)?.mode === 'off', 'PUT sends off')
    await context.close()
  }

  console.log('Checking a locked mode is read-only with its reason')
  {
    const state = { setting: { mode: 'experimental', locked: true, lockReason }, puts: [] }
    const { context, page, admin } = await open(browser, state)
    await admin.getByText('Set by the server configuration').waitFor()
    await admin.getByText(lockReason).waitFor()
    assert(await radio(admin, 'Experimental').isChecked(), 'locked mode shows as checked')
    assert(await radio(admin, 'Off').isDisabled(), 'Off is disabled when locked')
    await page.screenshot({ path: resolve(shotDir, 'admin-encryption-locked.png') })
    assert(state.puts.length === 0, 'nothing is saved when locked')
    await context.close()
  }

  console.log('Checking a lock that appears after loading shows at once')
  {
    const state = { setting: { mode: 'off', locked: false }, puts: [], lockOnPut: true }
    const { context, admin } = await open(browser, state)
    await radio(admin, 'Experimental').click()
    await admin.getByText('The server configuration now sets this mode', { exact: false }).waitFor()
    await admin.getByText(lockReason).waitFor()
    assert(await radio(admin, 'Off').isChecked(), 'a refused change returns to the saved mode')
    assert(await radio(admin, 'Experimental').isDisabled(), 'the mode is read-only once locked')
    assert((await admin.locator('.form-error').count()) === 0, 'a lock is not shown as an error')
    await context.close()
  }

  console.log('Checking a failed load offers a retry')
  {
    const state = { setting: { mode: 'off', locked: false }, puts: [], failGets: 1 }
    const { context, admin } = await open(browser, state)
    await admin.getByRole('button', { name: 'Reload' }).click()
    await radio(admin, 'Off').waitFor()
    assert(await radio(admin, 'Off').isChecked(), 'the retry loads the mode')
    await context.close()
  }

  console.log('Checking the phone layout')
  {
    const state = { setting: { mode: 'experimental', locked: true, lockReason }, puts: [] }
    const { context, page, admin } = await open(browser, state, { width: 390, height: 844 })
    await admin.getByText(lockReason).waitFor()
    await page.screenshot({ path: resolve(shotDir, 'admin-encryption-locked-phone.png') })
    await context.close()
  }
  console.log('Administration → Encryption checks passed')
} finally {
  await browser.close()
}
