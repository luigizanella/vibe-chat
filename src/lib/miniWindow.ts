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
  const unlisten = await Promise.all([
    listen('mini-ready', () => void emit('music-state', getState())),
    listen<{ action: 'pause' | 'resume' | 'skip' }>('music-cmd', (e) => void controlMusic(channelId, e.payload.action)),
    listen<{ volume: number }>('music-volume', (e) => useSettings.getState().update({ musicVolume: e.payload.volume })),
    main.onFocusChanged(({ payload: focused }) => void (focused ? mini.hide() : mini.show()).catch(() => undefined)),
  ])
  return () => {
    unlisten.forEach((f) => f())
    void mini.close().catch(() => undefined)
  }
}
