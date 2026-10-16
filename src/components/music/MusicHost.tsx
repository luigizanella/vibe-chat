import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Pause, Play, SkipBack, SkipForward, Square, Volume2 } from 'lucide-react'
import { controlMusic, positionMs, syncClock, useMusic } from '@/data/music'
import { useMembers } from '@/data/queries'
import { useSettings } from '@/store/settings'
import { useVoice } from '@/store/voice'
import { toast } from '@/store/ui'
import { watchUrl } from '@/lib/youtube'
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

/* ---------------------------------------------------------------- cartão */
function PlayerCard({ channelId, session }: { channelId: string; session: MusicSession }) {
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
  return (
    <div className="w-[300px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-[var(--bg-elevated)] shadow-[var(--shadow)]" role="region" aria-label="Vibe Beats — player de música">
      <div className="relative bg-black" style={{ width: '100%', height: 200 }}>
        <div ref={hostRef} className="h-full w-full" />
        {needsClick && playing && (
          <button className="absolute inset-0 grid place-items-center border-0 bg-black/70 font-semibold text-white" onClick={() => { playerRef.current?.playVideo(); setNeedsClick(false) }}>
            <span className="flex items-center gap-2"><Play size={20} /> Clique para ouvir</span>
          </button>
        )}
      </div>
      <div className="p-3">
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-fg-muted uppercase">
          Vibe Beats <span className="rounded bg-[var(--accent)] px-1 text-[10px] text-[var(--accent-contrast)]">APP</span>
        </div>
        <div className="truncate font-semibold" title={session.title ?? ''}>{session.title}</div>
        <div className="mt-1 flex items-center gap-1">
          <button className={btn} aria-label="Voltar" data-tip="Voltar" onClick={() => void controlMusic(channelId, 'back')}><SkipBack size={16} /></button>
          <button className={btn} aria-label={playing ? 'Pausar' : 'Continuar'} data-tip={playing ? 'Pausar' : 'Continuar'} onClick={() => void controlMusic(channelId, playing ? 'pause' : 'resume')}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
          <button className={btn} aria-label="Pular" data-tip="Pular" onClick={() => void controlMusic(channelId, 'skip')}><SkipForward size={16} /></button>
          <button className={btn} aria-label="Parar e limpar a fila" data-tip="Parar" onClick={() => void controlMusic(channelId, 'stop')}><Square size={14} /></button>
          <Volume2 size={15} className="ml-1 shrink-0 text-fg-muted" aria-hidden />
          <input type="range" min={0} max={100} value={volume} aria-label="Volume da música (só para você)" className="min-w-0 flex-1" onChange={(e) => update({ musicVolume: Number(e.target.value) })} />
        </div>
        <a className="mt-1 inline-flex items-center gap-1 text-xs" href={watchUrl(session.video_id ?? '')} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Abrir no YouTube</a>
      </div>
    </div>
  )
}

/** Cartão flutuante do player: só existe enquanto você está numa chamada com música tocando. */
export function MusicHost() {
  const channelId = useVoice((s) => s.channelId)
  const serverId = useVoice((s) => s.target?.serverId)
  const status = useVoice((s) => s.status)
  const { data } = useMusic(channelId)
  const { data: members } = useMembers(serverId)
  const session = data?.session
  const botOn = !!members?.some((m) => m.profile?.is_bot)
  if (!channelId || !serverId || !session || session.status === 'idle' || !session.video_id || !botOn || status === 'idle') return null
  return (
    <div className="fixed right-3 bottom-3 z-40 max-md:left-3 max-md:right-3 max-md:flex max-md:justify-center" style={{ zIndex: 45 }}>
      <PlayerCard key={channelId} channelId={channelId} session={session} />
    </div>
  )
}
