import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createPlatform, type NotificationTarget, type PlatformAlert } from './platform'

const asWindow = (value: object) => value as Parameters<typeof createPlatform>[0]
const target = { accountId: 'alice', conversationId: 'private-thread' }
const alert: PlatformAlert = { title: 'IRCord', body: '', icon: '/icon.png', silent: true, target }

describe('notification platform', () => {
  test('a normal tab uses web notifications and handles worker messages', async () => {
    const worker = new EventTarget()
    let active: NotificationTarget | undefined
    let pushChanged = false
    let click: (() => void) | undefined
    const platform = createPlatform(asWindow({
      navigator: { userAgent: '', serviceWorker: worker },
      PushManager: {},
      __TAURI__: {},
      Notification: class {
        static permission = 'granted'
        close() {}
        set onclick(value: () => void) { click = value }
      },
    }))
    assert.equal(platform.kind, 'web')
    assert.equal(platform.notifications.webPush, true)
    assert.equal(await platform.notifications.getPermission(), 'granted')
    const stop = platform.notifications.onActivate((value) => (active = value))
    const stopPush = platform.notifications.onPushSubscriptionChange(() => (pushChanged = true))
    await platform.notifications.show(alert)
    click?.()
    assert.deepEqual(active, target)
    worker.dispatchEvent(new MessageEvent('message', {
      data: { type: 'open-conversation', conversationId: 'worker-thread' },
    }))
    assert.equal(active?.conversationId, 'worker-thread')
    worker.dispatchEvent(new MessageEvent('message', { data: { type: 'push-subscription-changed' } }))
    assert.equal(pushChanged, true)
    stop()
    stopPush()
  })

  test('the browser can display an alert through its service worker', async () => {
    const shown: unknown[] = []
    const platform = createPlatform(asWindow({
      navigator: {
        userAgent: 'Android',
        serviceWorker: { ready: Promise.resolve({ showNotification: async (...args: unknown[]) => shown.push(args) }) },
      },
      Notification: function unsupportedNotification() { throw new TypeError() },
    }))
    await platform.notifications.show(alert)
    assert.deepEqual(shown, [['IRCord', {
      body: '', icon: '/icon.png', silent: true, tag: 'private-thread', data: target,
    }]])
  })

  test('desktop uses native permission, presentation, and focus', async () => {
    const commands: Array<[string, unknown]> = []
    let listener: ((event: { payload: NotificationTarget }) => void) | undefined
    let stopped = false
    let active: NotificationTarget | undefined
    const platform = createPlatform(asWindow({
      __IRCordDesktop: { titleBar: 'macos' },
      __TAURI__: {
        core: {
          invoke: async (command: string, args: unknown) => {
            commands.push([command, args])
            return 'granted'
          },
        },
        event: {
          listen: async (_: string, callback: typeof listener) => {
            listener = callback
            return () => (stopped = true)
          },
        },
      },
    }))
    assert.equal(platform.titleBar, 'macos')
    assert.equal(platform.notifications.webPush, false)
    const stop = platform.notifications.onActivate((value) => (active = value))
    assert.equal(await platform.notifications.requestPermission(), 'granted')
    await platform.notifications.show(alert)
    listener?.({ payload: target })
    assert.deepEqual(active, target)
    await platform.focus()
    assert.deepEqual(commands, [
      ['request_notification_permission', undefined],
      ['show_notification', { title: 'IRCord', body: '', silent: true, target }],
      ['focus_notification_window', undefined],
    ])
    stop()
    assert.equal(stopped, true)
  })
})
