import { VolumeX, Volume2, Pause, Play, SkipForward } from 'lucide-react'
import { useEffect, useState } from 'react'
import '@/store/settings' // aplica o tema salvo nesta janela

export interface MiniState {
  title: string
  playing: boolean
  volume: number
}

/**
 * Janela secundária do app desktop (sempre no topo, sem borda). Só mostra o estado e envia comandos;
 * quem toca o áudio (YouTube) continua sendo a janela principal.
 */
export function MiniPlayer() {
  const [s, setS] = useState<MiniState>({ title: 'Vibe Beats', playing: false, volume: 60 })

  useEffect(() => {
    let off: (() => void)[] = []
    let dead = false
    void (async () => {
      const { listen, emit } = await import('@tauri-apps/api/event')
      const un = await listen<MiniState>('music-state', (e) => setS(e.payload))
      if (dead) return un()
      off = [un]
      void emit('mini-ready')
    })()
    return () => {
      dead = true
      off.forEach((f) => f())
    }
  }, [])

  const send = async (event: string, payload?: unknown) => (await import('@tauri-apps/api/event')).emit(event, payload)

  return (
    <div className="flex h-screen select-none flex-col justify-center gap-1 rounded-xl border border-border bg-[var(--bg-elevated)] px-3 text-fg" data-tauri-drag-region>
      <div className="flex items-center gap-2" data-tauri-drag-region>
        <span className="rounded bg-[var(--accent)] px-1 text-[10px] font-bold text-[var(--accent-contrast)]" data-tauri-drag-region>VIBE BEATS</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={s.title} data-tauri-drag-region>{s.title}</span>
      </div>
      <div className="flex items-center gap-1">
        <button className="icon-btn h-8 w-8" aria-label={s.playing ? 'Pausar' : 'Continuar'} onClick={() => void send('music-cmd', { action: s.playing ? 'pause' : 'resume' })}>{s.playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="icon-btn h-8 w-8" aria-label="Pular" onClick={() => void send('music-cmd', { action: 'skip' })}><SkipForward size={16} /></button>
        <button className="icon-btn ml-1 h-8 w-8" aria-label={s.volume === 0 ? 'Ativar som' : 'Silenciar'} onClick={() => void send('music-volume', { volume: s.volume === 0 ? 60 : 0 })}>{s.volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
        <input type="range" min={0} max={100} value={s.volume} aria-label="Volume da música" className="min-w-0 flex-1" onChange={(e) => { const v = Number(e.target.value); setS((x) => ({ ...x, volume: v })); void send('music-volume', { volume: v }) }} />
      </div>
    </div>
  )
}
