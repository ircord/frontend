export type PlatformPermission = NotificationPermission | 'unsupported'

export interface NotificationTarget {
  conversationId: string
  accountId?: string
}

export interface PlatformAlert {
  title: string
  body: string
  icon: string
  silent: boolean
  target?: NotificationTarget
}

type Unlisten = () => void
type Activate = (target: NotificationTarget) => void

interface PlatformNotifications {
  supported: boolean
  webPush: boolean
  requiresHomeScreen: boolean
  getPermission(): Promise<PlatformPermission>
  requestPermission(): Promise<PlatformPermission>
  onPermissionChange(callback: Unlisten): Unlisten
  show(alert: PlatformAlert): Promise<void>
  onActivate(callback: Activate): Unlisten
  onPushSubscriptionChange(callback: Unlisten): Unlisten
}

interface DesktopBridge {
  core: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  }
  event: {
    listen<T>(event: string, callback: (event: { payload: T }) => void): Promise<Unlisten>
  }
  window: {
    getCurrentWindow(): DesktopWindow
  }
}

type TitleBar = 'macos' | 'windows' | 'linux'
export type ResizeEdge = 'North' | 'NorthEast' | 'East' | 'SouthEast' | 'South' | 'SouthWest' | 'West' | 'NorthWest'

interface DesktopWindow {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  isFullscreen(): Promise<boolean>
  startResizeDragging(direction: ResizeEdge): Promise<void>
}

type ClientWindow = Window & typeof globalThis & {
  __IRCordDesktop?: { titleBar: TitleBar }
  __TAURI__?: DesktopBridge
}

function webNotifications(window: ClientWindow): PlatformNotifications {
  const { navigator } = window
  const serviceWorker = navigator.serviceWorker
  const supported = typeof window.Notification !== 'undefined'
  const activation = new Set<Activate>()

  return {
    supported,
    webPush: !!serviceWorker && 'PushManager' in window,
    requiresHomeScreen: /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    async getPermission() {
      return supported ? window.Notification.permission : 'unsupported'
    },
    async requestPermission() {
      return supported ? window.Notification.requestPermission() : 'unsupported'
    },
    onPermissionChange(callback) {
      let disposed = false
      let status: PermissionStatus | undefined
      void navigator.permissions?.query({ name: 'notifications' }).then((permission) => {
        if (disposed) return
        status = permission
        status.addEventListener('change', callback)
      }).catch(() => {})
      return () => {
        disposed = true
        status?.removeEventListener('change', callback)
      }
    },
    async show({ title, body, icon, silent, target }) {
      const options = { body, icon, silent, tag: target?.conversationId }
      let notification: Notification
      try {
        notification = new window.Notification(title, options)
      } catch {
        // Android browsers use a service worker to display notifications and open the thread.
        const registration = await serviceWorker?.ready
        await registration?.showNotification(title, { ...options, data: target }).catch(() => {})
        return
      }
      notification.onclick = () => {
        if (target) for (const callback of activation) callback(target)
        notification.close()
      }
    },
    onActivate(callback) {
      const listener = ({ data }: MessageEvent) => {
        if (data?.type === 'open-conversation') callback(data)
      }
      activation.add(callback)
      serviceWorker?.addEventListener('message', listener)
      return () => {
        activation.delete(callback)
        serviceWorker?.removeEventListener('message', listener)
      }
    },
    onPushSubscriptionChange(callback) {
      const listener = ({ data }: MessageEvent) => {
        if (data?.type === 'push-subscription-changed') callback()
      }
      serviceWorker?.addEventListener('message', listener)
      return () => serviceWorker?.removeEventListener('message', listener)
    },
  }
}

function desktopNotifications(bridge: DesktopBridge): PlatformNotifications {
  const permission = (command: string) =>
    bridge.core.invoke<PlatformPermission>(command).catch(() => 'unsupported' as const)
  const noListener = () => () => {}
  return {
    supported: true,
    webPush: false,
    requiresHomeScreen: false,
    getPermission: () => permission('notification_permission'),
    requestPermission: () => permission('request_notification_permission'),
    onPermissionChange: noListener, // The store refreshes on returning to the window.
    show: ({ title, body, silent, target }) =>
      bridge.core.invoke('show_notification', { title, body, silent, target }),
    onActivate(callback) {
      let disposed = false
      let unlisten: Unlisten | undefined
      void bridge.event.listen<NotificationTarget>('ircord-notification-activated', ({ payload }) => {
        if (!disposed) callback(payload)
      }).then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      }).catch(() => {})
      return () => {
        disposed = true
        unlisten?.()
      }
    },
    onPushSubscriptionChange: noListener,
  }
}

export function createPlatform(window: ClientWindow) {
  const desktop = window.__IRCordDesktop
  const bridge = desktop && window.__TAURI__
  const titleBar = bridge ? desktop?.titleBar : undefined
  return {
    kind: bridge ? 'tauri' as const : 'web' as const,
    titleBar,
    windowControls: titleBar !== 'macos' ? bridge?.window?.getCurrentWindow() : undefined,
    notifications: bridge ? desktopNotifications(bridge) : webNotifications(window),
    async focus() {
      if (bridge) await bridge.core.invoke('focus_notification_window')
      else window.focus()
    },
  }
}
