import { useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { Headphones, HeadphoneOff, Maximize2, Mic, MicOff, Monitor, MonitorOff, PhoneOff, Pin, PinOff, Signal, Video, VideoOff, Volume2, VolumeX, Loader2, RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import { Track } from 'livekit-client'
import { useVoice, type VoiceParticipant } from '@/store/voice'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'
import { useSession } from '@/store/session'
import { useMembers } from '@/data/queries'
import { useVoiceOccupants } from '@/data/presence'
import { Avatar } from '@/components/ui'
import { codeLabel } from '@/lib/keys'
import { UserSettingsModal } from '@/components/settings/UserSettings'
import type { Member } from '@/lib/types'

interface TileSpec {
  key: string
  identity: string
  kind: 'camera' | 'screen'
  p: VoiceParticipant
}

function VideoTile({ spec, big, member, onFocus, focused }: { spec: TileSpec; big?: boolean; member?: Member; onFocus: () => void; focused: boolean }) {
  const room = useVoice((s) => s.room)
  const version = useVoice((s) => s.version)
  const volume = useVoice((s) => s.volumes[spec.identity] ?? 1)
  const setVolume = useVoice((s) => s.setVolume)
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const { p, kind } = spec
  const source = kind === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare

  const participant = room && (p.isLocal ? room.localParticipant : room.remoteParticipants.get(p.identity))
  const pub = participant?.getTrackPublication(source)
  const track = pub?.videoTrack
  const hasVideo = !!track && !pub?.isMuted

  useEffect(() => {
    const el = videoRef.current
    if (!track || !el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track, version])

  const name = member?.nickname || member?.profile?.display_name || p.name
  const label = kind === 'screen' ? `Tela de ${name}` : name
  const mirror = p.isLocal && kind === 'camera'

  return (
    <div
      ref={wrapRef}
      className={clsx('group relative overflow-hidden rounded-xl bg-[var(--bg-tertiary)]', big ? 'h-full w-full' : 'aspect-video w-full', p.speaking && kind === 'camera' && 'ring-[3px] ring-[var(--success)]')}
      onDoubleClick={() => void wrapRef.current?.requestFullscreen?.()}
    >
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted className={clsx('h-full w-full', kind === 'screen' ? 'object-contain bg-black' : 'object-cover', mirror && '-scale-x-100')} aria-label={label} />
      ) : (
        <div className="grid h-full w-full place-items-center">
          <div className={clsx('rounded-full transition-shadow', p.speaking && 'shadow-[0_0_0_4px_var(--success)]')}>
            <Avatar path={member?.profile?.avatar_path} name={name} id={p.identity} size={big ? 120 : 72} />
          </div>
          {kind === 'screen' && <span className="absolute bottom-10 text-fg-muted">Carregando transmissão…</span>}
        </div>
      )}
      <div className="absolute bottom-0 left-0 flex max-w-full items-center gap-1.5 rounded-tr-lg bg-black/60 px-2 py-1 text-xs text-white">
        {kind === 'screen' && <Monitor size={12} />}
        {!p.micOn && kind === 'camera' && <MicOff size={12} className="text-[var(--danger)]" aria-label="Microfone desligado" />}
        <span className="truncate font-semibold">{label}{p.isLocal ? ' (você)' : ''}</span>
        {p.quality !== 'unknown' && p.quality !== 'excellent' && <Signal size={12} className={p.quality === 'good' ? 'text-warning' : 'text-danger'} aria-label={`Conexão ${p.quality}`} />}
      </div>
      <div className="absolute top-2 right-2 flex gap-1 rounded-lg bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {!p.isLocal && (
          <div className="flex items-center gap-1 px-1">
            {volume === 0 ? <VolumeX size={14} className="text-white" /> : <Volume2 size={14} className="text-white" />}
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(p.identity, Number(e.target.value))} className="w-20" aria-label={`Volume de ${name}`} />
          </div>
        )}
        <button className="icon-btn h-7 w-7 text-white" onClick={onFocus} aria-label={focused ? 'Soltar destaque' : 'Destacar'} data-tip={focused ? 'Soltar destaque' : 'Destacar'}>{focused ? <PinOff size={15} /> : <Pin size={15} />}</button>
        <button className="icon-btn h-7 w-7 text-white" onClick={() => void wrapRef.current?.requestFullscreen?.()} aria-label="Tela cheia" data-tip="Tela cheia"><Maximize2 size={15} /></button>
      </div>
    </div>
  )
}

export function ControlBar({ compact }: { compact?: boolean }) {
  const { micMuted, deafened, camOn, screenOn, toggleMic, toggleDeafen, toggleCamera, toggleScreen, leave, pttActive } = useVoice()
  const ptt = useSettings((s) => s.settings.voice.pttEnabled)
  const open = useUI((s) => s.openModal)
  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
  const size = compact ? 18 : 22
  return (
    <div className="flex items-center justify-center gap-2" role="toolbar" aria-label="Controles da chamada">
      <button className={clsx('icon-btn', compact ? '' : 'h-12 w-12 rounded-full', micMuted && 'danger bg-[var(--bg-hover)]')} onClick={() => void toggleMic()} aria-pressed={micMuted} aria-label={micMuted ? 'Ativar microfone' : 'Silenciar microfone'} data-tip={micMuted ? 'Ativar microfone' : 'Silenciar microfone'}>
        {micMuted ? <MicOff size={size} /> : <Mic size={size} className={ptt && !pttActive ? 'opacity-60' : ''} />}
      </button>
      <button className={clsx('icon-btn', compact ? '' : 'h-12 w-12 rounded-full', deafened && 'danger bg-[var(--bg-hover)]')} onClick={() => void toggleDeafen()} aria-pressed={deafened} aria-label={deafened ? 'Desativar ensurdecer' : 'Ensurdecer'} data-tip={deafened ? 'Voltar a ouvir' : 'Ensurdecer'}>
        {deafened ? <HeadphoneOff size={size} /> : <Headphones size={size} />}
      </button>
      <button className={clsx('icon-btn', compact ? '' : 'h-12 w-12 rounded-full', camOn && 'active bg-[var(--bg-selected)]')} onClick={() => void toggleCamera()} aria-pressed={camOn} aria-label={camOn ? 'Desligar câmera' : 'Ligar câmera'} data-tip={camOn ? 'Desligar câmera' : 'Ligar câmera'}>
        {camOn ? <Video size={size} /> : <VideoOff size={size} />}
      </button>
      <button className={clsx('icon-btn', compact ? '' : 'h-12 w-12 rounded-full', screenOn && 'active bg-[var(--bg-selected)] text-success')} onClick={() => void toggleScreen()} disabled={!canShare} aria-pressed={screenOn} aria-label={screenOn ? 'Parar compartilhamento' : 'Compartilhar tela'} data-tip={!canShare ? 'Seu navegador não suporta compartilhamento de tela' : screenOn ? 'Parar compartilhamento' : 'Compartilhar tela'}>
        {screenOn ? <MonitorOff size={size} /> : <Monitor size={size} />}
      </button>
      {!compact && <button className="icon-btn h-12 w-12 rounded-full" onClick={() => open(<UserSettingsModal initialTab="voice" />)} aria-label="Configurações de voz" data-tip="Configurações de voz"><SettingsIcon size={size} /></button>}
      <button className={clsx('icon-btn', compact ? '' : 'h-12 w-14 rounded-full', 'bg-[var(--danger)] text-white hover:!bg-[var(--danger-hover)] hover:!text-white')} onClick={() => void leave()} aria-label="Sair da chamada" data-tip="Sair da chamada"><PhoneOff size={size} /></button>
    </div>
  )
}

function gridCols(n: number): string {
  if (n <= 1) return 'grid-cols-1'
  if (n <= 4) return 'grid-cols-1 sm:grid-cols-2'
  if (n <= 9) return 'grid-cols-2 lg:grid-cols-3'
  return 'grid-cols-2 lg:grid-cols-4'
}

export function VoiceStage({ channel, serverId }: { channel: { id: string; name: string; server_id: string }; serverId: string }) {
  const { channelId, status, error, participants, focus, setFocus, join, retry, target } = useVoice()
  const meId = useSession((s) => s.user?.id)
  const { data: members } = useMembers(serverId)
  const occupants = useVoiceOccupants()[channel.id] ?? []
  const joined = channelId === channel.id
  const settings = useSettings((s) => s.settings)
  const memberOf = (id: string) => members?.find((m) => m.user_id === id)

  const tiles = useMemo<TileSpec[]>(() => {
    const out: TileSpec[] = []
    for (const p of participants) {
      out.push({ key: `${p.identity}:cam`, identity: p.identity, kind: 'camera', p })
      if (p.screenOn) out.push({ key: `${p.identity}:screen`, identity: p.identity, kind: 'screen', p })
    }
    return out
  }, [participants])

  const focusedTile = tiles.find((t) => t.key === focus)
  const screenTiles = tiles.filter((t) => t.kind === 'screen')
  const spotlight = focusedTile ?? (screenTiles.length ? screenTiles[screenTiles.length - 1] : undefined)

  useEffect(() => {
    if (focus && !tiles.some((t) => t.key === focus)) setFocus(null)
  }, [tiles, focus, setFocus])

  if (!joined) {
    return (
      <div className="grid h-full place-items-center overflow-y-auto p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-tertiary"><Volume2 size={30} /></div>
          <h2 className="m-0 text-2xl font-bold">{channel.name}</h2>
          {occupants.length > 0 ? (
            <div className="flex flex-col items-center gap-2"><div className="flex -space-x-2">{occupants.slice(0, 8).map((id) => <Avatar key={id} path={memberOf(id)?.profile?.avatar_path} name={memberOf(id)?.profile?.display_name ?? '?'} id={id} size={36} ring="var(--bg-primary)" />)}</div>
              <p className="m-0 text-fg-2">{occupants.map((id) => memberOf(id)?.profile?.display_name ?? 'Alguém').slice(0, 4).join(', ')}{occupants.length > 4 ? ` e mais ${occupants.length - 4}` : ''} {occupants.length === 1 ? 'está' : 'estão'} na sala.</p></div>
          ) : <p className="m-0 text-fg-2">Ninguém está aqui ainda.</p>}
          {status === 'failed' && error && target?.id === channel.id && <p className="error-text" role="alert">{error}</p>}
          <button className="btn btn-primary h-11 px-8 text-base" disabled={status === 'connecting'} onClick={() => void join({ id: channel.id, serverId, name: channel.name })}>
            {status === 'connecting' ? <Loader2 className="spin" size={18} /> : <Mic size={18} />} Entrar na chamada
          </button>
          <p className="hint max-w-xs">Seu navegador pedirá permissão para usar o microfone. Câmera e tela são opcionais e só ligam quando você clicar.</p>
        </div>
      </div>
    )
  }

  const others = tiles.filter((t) => t !== spotlight)
  const statusBanner =
    status === 'connecting' ? { text: 'Conectando…', tone: 'info' } :
    status === 'reconnecting' ? { text: error ?? 'Reconectando…', tone: 'warn' } :
    status === 'failed' ? { text: error ?? 'Falha na conexão.', tone: 'err' } : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#101114]">
      {statusBanner && (
        <div className={clsx('flex items-center justify-center gap-3 px-4 py-2 text-sm', statusBanner.tone === 'err' ? 'bg-[var(--danger)] text-white' : statusBanner.tone === 'warn' ? 'bg-warning text-black' : 'bg-[var(--accent)] text-white')} role="status">
          {status !== 'failed' && <Loader2 size={14} className="spin" />}{statusBanner.text}
          {(status === 'failed' || status === 'reconnecting') && <button className="btn btn-sm" onClick={() => void retry()}><RefreshCw size={13} /> Tentar agora</button>}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!participants.length ? (
          <div className="grid h-full place-items-center text-fg-muted"><Loader2 className="spin" /></div>
        ) : spotlight ? (
          <div className="flex h-full flex-col gap-3 lg:flex-row">
            <div className="min-h-[200px] min-w-0 flex-1"><VideoTile spec={spotlight} big member={memberOf(spotlight.identity)} focused={focus === spotlight.key} onFocus={() => setFocus(focus === spotlight.key ? null : spotlight.key)} /></div>
            {others.length > 0 && (
              <div className="flex shrink-0 gap-2 overflow-x-auto lg:w-56 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
                {others.map((t) => <div key={t.key} className="w-44 shrink-0 lg:w-full"><VideoTile spec={t} member={memberOf(t.identity)} focused={false} onFocus={() => setFocus(t.key)} /></div>)}
              </div>
            )}
          </div>
        ) : (
          <div className={clsx('grid h-full auto-rows-fr content-center gap-3', gridCols(tiles.length))}>
            {tiles.map((t) => <VideoTile key={t.key} spec={t} member={memberOf(t.identity)} focused={false} onFocus={() => setFocus(t.key)} />)}
          </div>
        )}
      </div>
      <div className="flex flex-col items-center gap-2 border-t border-white/10 bg-[#17181c] px-3 py-3">
        <ControlBar />
        <div className="text-[11px] text-fg-muted">
          {meId && participants.some((p) => p.isLocal && p.screenOn) && <span className="mr-3 text-success">● Você está transmitindo a tela</span>}
          {settings.voice.pttEnabled && <span>Push-to-talk: segure <kbd className="rounded bg-tertiary px-1">{codeLabel(settings.keybinds.pushToTalk)}</kbd></span>}
        </div>
      </div>
    </div>
  )
}
