import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { GripHorizontal, Minus, Pause, PictureInPicture2, Pin, Play, Plus, SkipBack, SkipForward, Square, Volume2, VolumeX, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { isTauri } from '@/lib/env'
import { controlMusic, positionMs, syncClock, useMusic } from '@/data/music'
import { useMembers } from '@/data/queries'
import { useSettings } from '@/store/settings'
import { useVoice } from '@/store/voice'
import { toast } from '@/store/ui'
import type { MusicSession } from '@/lib/types'

/* ------------------------------------------------------- YouTube IFrame API */
interface YTPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getPlayerState(): number
  setVolume(v: number): void
  destroy(): void
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer
}
declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      if (window.YT) resolve(window.YT)
    }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.onerror = () => {
      apiPromise = null
      reject(new Error('Não foi possível carregar o player do YouTube (bloqueado pela rede ou por extensão?).'))
    }
    document.head.appendChild(s)
  })
  return apiPromise
}

const ERRORS: Record<number, string> = {
  2: 'Link de vídeo inválido.',
  5: 'O player do YouTube falhou ao abrir este vídeo.',
  100: 'Vídeo indisponível (removido ou privado).',
  101: 'O dono do vídeo não permite tocar fora do YouTube.',
  150: 'O dono do vídeo não permite tocar fora do YouTube.',
  153: 'O YouTube recusou o player neste ambiente.',
}

const POS_KEY = 'vibe.music.pos'
const MIN_KEY = 'vibe.music.min'
const PREV_VOL_KEY = 'vibe.music.prevvol'
function readJson<T>(k: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------- cartão */
function PlayerCard({ channelId, session, mode, onPip, onPipClose }: { channelId: string; session: MusicSession; mode: 'float' | 'pip'; onPip?: () => void; onPipClose?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const loaded = useRef<string | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [ready, setReady] = useState(false)
  const [needsClick, setNeedsClick] = useState(false)
  const volume = useSettings((s) => s.settings.musicVolume)
  const update = useSettings((s) => s.update)

  // cria o player uma vez
  useEffect(() => {
    let destroyed = false
    void syncClock()
    loadYouTubeApi().then(
      (YT) => {
        if (destroyed || !hostRef.current) return
        const el = document.createElement('div')
        hostRef.current.replaceChildren(el)
        playerRef.current = new YT.Player(el, {
          width: '100%',
          height: '100%',
          videoId: sessionRef.current.video_id ?? undefined,
          host: 'https://www.youtube-nocookie.com',
          playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1, playsinline: 1, origin: window.location.origin },
          events: {
            onReady: () => setReady(true),
            onStateChange: (e: { data: number }) => {
              if (e.data === 0) {
                // fim da faixa: todos avisam; só o primeiro vale (o banco confere o vídeo esperado)
                const vid = sessionRef.current.video_id
                setTimeout(() => void controlMusic(channelId, 'skip', vid), Math.random() * 700)
              }
              if (e.data === 1) setNeedsClick(false)
            },
            onError: (e: { data: number }) => {
              toast.error(`${ERRORS[e.data] ?? 'Não foi possível tocar este vídeo.'} Pulando…`)
              const vid = sessionRef.current.video_id
              setTimeout(() => void controlMusic(channelId, 'skip', vid), Math.random() * 700)
            },
          },
        })
        loaded.current = sessionRef.current.video_id
      },
      (err: Error) => toast.error(err.message),
    )
    return () => {
      destroyed = true
      playerRef.current?.destroy()
      playerRef.current = null
      loaded.current = null
      setReady(false)
    }
  }, [channelId])

  // aplica o estado compartilhado ao player
  useEffect(() => {
    const p = playerRef.current
    if (!ready || !p || !session.video_id) return
    const pos = positionMs(session) / 1000
    if (loaded.current !== session.video_id) {
      loaded.current = session.video_id
      p.loadVideoById({ videoId: session.video_id, startSeconds: pos })
      if (session.status === 'paused') setTimeout(() => { p.seekTo(session.paused_ms / 1000, true); p.pauseVideo() }, 700)
    } else if (session.status === 'playing') {
      p.seekTo(pos, true)
      p.playVideo()
    } else if (session.status === 'paused') {
      p.pauseVideo()
      p.seekTo(session.paused_ms / 1000, true)
    }
  }, [ready, session])

  // correção de deriva e detecção de autoplay bloqueado
  useEffect(() => {
    if (!ready) return
    const iv = setInterval(() => {
      const p = playerRef.current
      const s = sessionRef.current
      if (!p || s.status !== 'playing') return
      const state = p.getPlayerState()
      if (state === 1) {
        const drift = Math.abs(p.getCurrentTime() * 1000 - positionMs(s))
        if (drift > 2500) p.seekTo(positionMs(s) / 1000, true)
      } else if (state === -1 || state === 5 || state === 2) {
        p.playVideo()
        setNeedsClick(true)
      }
    }, 3000)
    return () => clearInterval(iv)
  }, [ready])

  useEffect(() => {
    if (ready) playerRef.current?.setVolume(volume)
  }, [ready, volume])

  const playing = session.status === 'playing'
  const btn = 'icon-btn h-8 w-8'
  const float = mode === 'float'
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => readJson<{ x: number; y: number }>(POS_KEY))
  const [minimized, setMinimized] = useState(() => localStorage.getItem(MIN_KEY) === '1')

  const clamp = (x: number, y: number) => {
    const r = wrapRef.current?.getBoundingClientRect()
    const w = r?.width ?? 300
    const h = r?.height ?? 120
    return { x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)), y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8)) }
  }
  // mantém o player sempre dentro da tela (posição salva de outra janela, expandir/minimizar, redimensionar)
  useLayoutEffect(() => {
    if (float && pos) setPos((p) => (p ? clamp(p.x, p.y) : p))
  }, [minimized, float]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!float) return
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [float])

  const startDrag = (e: React.PointerEvent) => {
    if (!float || (e.target as HTMLElement).closest('button')) return
    const r = wrapRef.current!.getBoundingClientRect()
    const dx = e.clientX - r.left
    const dy = e.clientY - r.top
    const move = (ev: PointerEvent) => setPos(clamp(ev.clientX - dx, ev.clientY - dy))
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const final = clamp(ev.clientX - dx, ev.clientY - dy)
      setPos(final)
      try { localStorage.setItem(POS_KEY, JSON.stringify(final)) } catch { /* sem storage */ }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const toggleMin = () => setMinimized((m) => {
    try { localStorage.setItem(MIN_KEY, m ? '0' : '1') } catch { /* sem storage */ }
    return !m
  })
  const toggleMute = () => {
    if (volume > 0) {
      try { localStorage.setItem(PREV_VOL_KEY, String(volume)) } catch { /* sem storage */ }
      update({ musicVolume: 0 })
    } else {
      update({ musicVolume: Number(localStorage.getItem(PREV_VOL_KEY)) || 60 })
    }
  }
  const [pinned, setPinned] = useState(false)
  const togglePin = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().setAlwaysOnTop(!pinned)
      setPinned(!pinned)
    } catch {
      toast.error('Não foi possível fixar a janela por cima.')
    }
  }
  const hasDocPip = typeof window !== 'undefined' && 'documentPictureInPicture' in window
  const showMini = float && minimized
  const style = float ? (pos ? { left: pos.x, top: pos.y } : { right: 12, bottom: 12 }) : undefined

  return (
    <div
      ref={wrapRef}
      className={`${float ? 'fixed z-[45] w-[300px] max-w-[calc(100vw-1.5rem)]' : 'w-full'} overflow-hidden rounded-lg border border-border bg-[var(--bg-elevated)] text-fg shadow-[var(--shadow)]`}
      style={style}
      role="region"
      aria-label="Vibe Beats — player de música"
    >
      <div className={`flex items-center gap-1.5 px-2 py-1 ${float ? 'cursor-grab active:cursor-grabbing' : ''}`} onPointerDown={startDrag}>
        {float && <GripHorizontal size={14} className="shrink-0 text-fg-muted" aria-hidden />}
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] font-bold tracking-wide text-fg-muted uppercase">
          Vibe Beats <span className="rounded bg-[var(--accent)] px-1 text-[10px] text-[var(--accent-contrast)]">APP</span>
        </span>
        {float && hasDocPip && onPip && <button className="btn btn-sm h-7 gap-1 px-2 text-xs" aria-label="Destacar em janela flutuante" data-tip="Fica visível ao trocar de aba ou app" onClick={onPip}><PictureInPicture2 size={13} /> Destacar</button>}
        {float && !hasDocPip && !isTauri && <span className="text-[10px] text-fg-muted" title="Este navegador não tem janela flutuante. Use Chrome ou Edge, ou o app para Windows.">sem janela flutuante</span>}
        {float && !hasDocPip && isTauri && <button className={`icon-btn h-7 w-7 ${pinned ? 'active' : ''}`} aria-pressed={pinned} aria-label="Manter o app por cima de outras janelas" data-tip={pinned ? 'Desafixar o app' : 'Manter o app por cima das outras janelas'} onClick={() => void togglePin()}><Pin size={14} /></button>}
        {float && <button className="icon-btn h-7 w-7" aria-label={minimized ? 'Expandir player' : 'Minimizar player'} data-tip={minimized ? 'Expandir' : 'Minimizar'} onClick={toggleMin}>{minimized ? <Plus size={14} /> : <Minus size={14} />}</button>}
        {!float && onPipClose && <button className="icon-btn h-7 w-7" aria-label="Voltar para a janela do app" data-tip="Voltar para o app" onClick={onPipClose}><X size={14} /></button>}
      </div>
      {/* o player continua montado (e tocando) mesmo minimizado */}
      <div className="relative bg-black" style={{ width: '100%', height: showMini ? 0 : float ? 170 : 190, overflow: 'hidden' }}>
        <div ref={hostRef} className="h-full w-full" />
        {needsClick && playing && (
          <button className="absolute inset-0 grid place-items-center border-0 bg-black/70 font-semibold text-white" onClick={() => { playerRef.current?.playVideo(); setNeedsClick(false) }}>
            <span className="flex items-center gap-2"><Play size={20} /> Clique para ouvir</span>
          </button>
        )}
      </div>
      <div className="px-3 pt-2 pb-3">
        <div className="truncate text-sm font-semibold" title={session.title ?? ''}>{session.title}</div>
        <div className="mt-1 flex items-center gap-1">
          {!showMini && <button className={btn} aria-label="Voltar" data-tip="Voltar" onClick={() => void controlMusic(channelId, 'back')}><SkipBack size={16} /></button>}
          <button className={btn} aria-label={playing ? 'Pausar' : 'Continuar'} data-tip={playing ? 'Pausar' : 'Continuar'} onClick={() => void controlMusic(channelId, playing ? 'pause' : 'resume')}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
          <button className={btn} aria-label="Pular" data-tip="Pular" onClick={() => void controlMusic(channelId, 'skip')}><SkipForward size={16} /></button>
          {!showMini && <button className={btn} aria-label="Parar e limpar a fila" data-tip="Parar" onClick={() => void controlMusic(channelId, 'stop')}><Square size={14} /></button>}
          <button className="icon-btn ml-1 h-8 w-8 shrink-0" aria-label={volume === 0 ? 'Ativar o som da música' : 'Silenciar a música (só para você)'} data-tip={volume === 0 ? 'Ativar som' : 'Silenciar'} aria-pressed={volume === 0} onClick={toggleMute}>{volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
          {!showMini && <input type="range" min={0} max={100} value={volume} aria-label="Volume da música (só para você)" className="min-w-0 flex-1" onChange={(e) => update({ musicVolume: Number(e.target.value) })} />}
        </div>
      </div>
    </div>
  )
}

type DocPip = { requestWindow: (o?: { width?: number; height?: number }) => Promise<Window> }

/** Cartão flutuante do player: só existe enquanto você está numa chamada com música tocando. */
export function MusicHost() {
  const channelId = useVoice((s) => s.channelId)
  const serverId = useVoice((s) => s.target?.serverId)
  const status = useVoice((s) => s.status)
  const { data } = useMusic(channelId)
  const { data: members } = useMembers(serverId)
  const [pip, setPip] = useState<Window | null>(null)
  const session = data?.session
  const botOn = !!members?.some((m) => m.profile?.is_bot)
  const active = !!channelId && !!serverId && !!session && session.status !== 'idle' && !!session.video_id && botOn && status !== 'idle'

  // fecha a janela flutuante quando a música/chamada acaba
  useEffect(() => {
    if (!active && pip) {
      pip.close()
      setPip(null)
    }
  }, [active, pip])

  const openPip = async () => {
    const api = (window as unknown as { documentPictureInPicture?: DocPip }).documentPictureInPicture
    if (!api) return
    try {
      const w = await api.requestWindow({ width: 340, height: 380 })
      // copia estilos e atributos do tema para a nova janela
      for (const ss of Array.from(document.styleSheets)) {
        try {
          const st = w.document.createElement('style')
          st.textContent = Array.from(ss.cssRules).map((r) => r.cssText).join('\n')
          w.document.head.appendChild(st)
        } catch {
          if (ss.href) {
            const l = w.document.createElement('link')
            l.rel = 'stylesheet'
            l.href = ss.href
            w.document.head.appendChild(l)
          }
        }
      }
      for (const a of document.documentElement.getAttributeNames()) w.document.documentElement.setAttribute(a, document.documentElement.getAttribute(a) ?? '')
      w.document.body.style.margin = '0'
      w.document.body.style.background = 'var(--bg-primary)'
      w.addEventListener('pagehide', () => setPip(null))
      setPip(w)
    } catch {
      toast.error('Não foi possível abrir a janela flutuante.')
    }
  }

  // janela flutuante automática ao trocar de aba/app (Chrome/Edge: via Media Session; sem gesto o navegador pode recusar)
  const openRef = useRef(openPip)
  openRef.current = openPip
  useEffect(() => {
    if (!active || isTauri) return
    try {
      navigator.mediaSession?.setActionHandler('enterpictureinpicture' as MediaSessionAction, () => void openRef.current())
    } catch {
      /* ação não suportada neste navegador */
    }
    return () => {
      try { navigator.mediaSession?.setActionHandler('enterpictureinpicture' as MediaSessionAction, null) } catch { /* nada */ }
    }
  }, [active])

  // app desktop: mini janela sempre no topo quando a janela principal perde o foco
  const sessionRef = useRef(session)
  sessionRef.current = session
  const volume = useSettings((s) => s.settings.musicVolume)
  const volRef = useRef(volume)
  volRef.current = volume
  const getMini = () => ({ title: sessionRef.current?.title ?? 'Vibe Beats', playing: sessionRef.current?.status === 'playing', volume: volRef.current })
  useEffect(() => {
    if (!isTauri || !active || !channelId) return
    let off: (() => void) | undefined
    let dead = false
    void import('@/lib/miniWindow').then((m) => m.attachMiniWindow(channelId, getMini)).then((f) => (dead ? f() : (off = f)), () => undefined)
    return () => {
      dead = true
      off?.()
    }
  }, [active, channelId])
  useEffect(() => {
    if (isTauri && active) void import('@tauri-apps/api/event').then((e) => e.emit('music-state', getMini()))
  }, [active, session?.title, session?.status, volume])

  if (!active) return null
  if (pip) return createPortal(<PlayerCard key={`pip-${channelId}`} channelId={channelId} session={session} mode="pip" onPipClose={() => { pip.close(); setPip(null) }} />, pip.document.body)
  return <PlayerCard key={channelId} channelId={channelId} session={session} mode="float" onPip={() => void openPip()} />
}