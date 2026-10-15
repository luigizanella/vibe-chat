import { isTauri } from './env'
import { useSettings } from '@/store/settings'

export type NotifPermission = 'granted' | 'denied' | 'default' | 'unsupported'

export async function notificationPermission(): Promise<NotifPermission> {
  if (isTauri) {
    try {
      const { isPermissionGranted } = await import('@tauri-apps/plugin-notification')
      return (await isPermissionGranted()) ? 'granted' : 'default'
    } catch {
      return 'unsupported'
    }
  }
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotifPermission> {
  if (isTauri) {
    try {
      const { requestPermission } = await import('@tauri-apps/plugin-notification')
      return (await requestPermission()) === 'granted' ? 'granted' : 'denied'
    } catch {
      return 'unsupported'
    }
  }
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.requestPermission()
}

let originalTitle: string | null = null
let flashTimer: ReturnType<typeof setInterval> | undefined

export function setUnreadTitle(count: number): void {
  originalTitle ??= document.title
  const base = originalTitle.replace(/^\(\d+\)\s/, '')
  document.title = count > 0 ? `(${count}) ${base}` : base
}

export function flashTitle(text: string): void {
  if (!useSettings.getState().settings.notifications.flashTitle || document.hasFocus()) return
  originalTitle ??= document.title
  const base = originalTitle
  clearInterval(flashTimer)
  let on = false
  flashTimer = setInterval(() => {
    on = !on
    document.title = on ? text : base
    if (document.hasFocus()) {
      clearInterval(flashTimer)
      document.title = base
    }
  }, 1000)
}

/** Notificação do sistema (navegador ou Tauri). Só dispara se o usuário autorizou. */
export async function desktopNotify(title: string, body: string, onClick?: () => void): Promise<void> {
  if (!useSettings.getState().settings.notifications.desktop) return
  if (document.hasFocus()) return
  if ((await notificationPermission()) !== 'granted') return
  if (isTauri) {
    try {
      const { sendNotification } = await import('@tauri-apps/plugin-notification')
      sendNotification({ title, body })
    } catch {
      /* ignora */
    }
    return
  }
  try {
    const n = new Notification(title, { body, silent: true, tag: title })
    n.onclick = () => {
      window.focus()
      onClick?.()
      n.close()
    }
  } catch {
    /* ignora */
  }
}
