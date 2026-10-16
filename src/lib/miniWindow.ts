import { controlMusic } from '@/data/music'
import { useSettings } from '@/store/settings'
import type { MiniState } from '@/components/music/MiniPlayer'

/**
 * Janela flutuante do app desktop (Tauri): aparece sempre no topo quando a janela principal perde o foco
 * (ou é minimizada / vai para a bandeja) e some quando você volta. Retorna uma função de limpeza.
 */
export async function attachMiniWindow(channelId: string, getState: () => MiniState): Promise<() => void> {
  const [{ WebviewWindow }, { getCurrentWindow }, { listen, emit }] = await Promise.all([
    import('@tauri-apps/api/webviewWindow'),
    import('@tauri-apps/api/window'),
    import('@tauri-apps/api/event'),
  ])
  const label = 'mini-player'
  const mini = (await WebviewWindow.getByLabel(label)) ?? new WebviewWindow(label, {
    url: '/?mini=1', title: 'Vibe Beats', width: 340, height: 108, alwaysOnTop: true, decorations: false, skipTaskbar: true,
    resizable: false, visible: false, focus: false, shadow: true,
  })
  const main = getCurrentWindow()
  let shown = false
  let busy = false
  // Única fonte da verdade: a janela principal está em foco? (eventos + checagem periódica, para nunca sobrar uma cópia por cima do app)
  const apply = async () => {
    if (busy) return
    busy = true
    try {
      const focused = await main.isFocused().catch(() => true)
      if (!focused && !shown) {
        shown = true
        await mini.show().catch(() => undefined)
      } else if (focused && shown) {
        shown = false
        await mini.hide().catch(() => undefined)
      }
    } finally {
      busy = false
    }
  }
  const unlisten = await Promise.all([
    listen('mini-ready', () => void emit('music-state', getState())),
    listen<{ action: 'pause' | 'resume' | 'skip' }>('music-cmd', (e) => void controlMusic(channelId, e.payload.action)),
    listen<{ volume: number }>('music-volume', (e) => useSettings.getState().update({ musicVolume: e.payload.volume })),
    main.onFocusChanged(() => void apply()),
  ])
  const iv = setInterval(() => void apply(), 700)
  return () => {
    clearInterval(iv)
    unlisten.forEach((f) => f())
    void mini.hide().catch(() => undefined)
    void mini.close().catch(() => undefined)
  }
}