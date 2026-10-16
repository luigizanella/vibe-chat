import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Headphones, HeadphoneOff, Maximize2, Mic, MicOff, Music, Monitor, MonitorOff, PhoneOff, Pin, PinOff, Signal, Video, VideoOff, Volume2, VolumeX, Loader2, RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import { Track } from 'livekit-client'
import { MusicPanel } from '@/components/music/MusicPanel'
import { useVoice, type VoiceParticipant } from '@/store/voice'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'
import { useSession } from '@/store/session'
import { useMembers } from '@/data/queries'
import { useVoiceOccupants } from '@/data/presence'
import { Avatar } from '@/components/ui'
import { codeLabel } from '@/lib/keys'
import { UserSettingsModal } from '@/components/settings/UserSettings'
import { requestScreenShare } from './ScreenShareModal'
import { useLocalNick, useUserMenu } from '@/components/userMenu'
import type { Member } from '@/lib/types'
import { MAX_TILES, bestGrid } from '@/lib/grid'

interface TileSpec {
  key: string
  identity: string
  kind: 'camera' | 'screen'
  p: VoiceParticipant
}

function VideoTile({ spec, big, member, onFocus, focused, serverId }: { spec: TileSpec; big?: boolean; member?: Member; onFocus: () => void; focused: boolean; serverId: string }) {
  const openProfile = useUI((s) => s.openProfile)
  const userMenu = useUserMenu(serverId)
  const localNick = useLocalNick()
  const room = useVoice((s) => s.room)
  const version = useVoice((s) => s.version)
  const volume = useVoice((s) => s.volumes[spec.identity] ?? 1)
  const setVolume = useVoice((s) => s.setVolume)
  const watching = useVoice((s) => s.watching)
  const watch = useVoice((s) => s.watch)
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

  const name = localNick(p.identity, member?.nickname || member?.profile?.display_name || p.name)
  const label = kind === 'screen' ? `Tela de ${name}` : name
  const mirror = p.isLocal && kind === 'camera'
  const notWatched = kind === 'screen' && !p.isLocal && watching !== p.identity

  return (
    <div
      ref={wrapRef}
      className={clsx('group relative h-full w-full overflow-hidden rounded-xl bg-[var(--bg-secondary)]', p.speaking && kind === 'camera' && 'outline-[3px] -outline-offset-[3px] outline-[var(--success)]')}
      onDoubleClick={() => void wrapRef.current?.requestFullscreen?.()}
      onContextMenu={(e) => userMenu(p.identity, e)}
    >
      {notWatched ? (
        <div className="grid h-full w-full place-content-center justify-items-center gap-2 bg-[var(--bg-tertiary)] p-3 pb-9 text-center">
          <Avatar path={member?.profile?.avatar_path} name={name} id={p.identity} size={big ? 96 : 44} />
          <span className="rounded bg-[var(--danger)] px-1.5 text-[11px] leading-5 font-bold text-white">AO VIVO</span>
          <button className="btn btn-primary btn-sm" onClick={() => watch(p.identity)}><Monitor size={14} /> Assistir transmissão</button>
        </div>
      ) : hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted className={clsx('h-full w-full', kind === 'screen' ? 'object-contain bg-black' : 'object-cover', mirror && '-scale-x-100')} aria-label={label} />
      ) : (
        <div className="grid h-full w-full place-items-center">
          <Avatar path={member?.profile?.avatar_path} name={name} id={p.identity} size={big ? 120 : 80} speaking={p.speaking} />
          {kind === 'screen' && <span className="absolute bottom-10 text-fg-muted">Carregando transmissão…</span>}
        </div>
      )}
      <div className="absolute bottom-0 left-0 flex max-w-full items-center gap-1.5 rounded-tr-lg bg-black/60 px-2 py-1 text-xs text-white">
        {kind === 'screen' && <span className="rounded bg-[var(--danger)] px-1 text-[10px] leading-4 font-bold text-white">AO VIVO</span>}
        {!p.micOn && kind === 'camera' && <MicOff size={12} className="text-[var(--danger)]" aria-label="Microfone desligado" />}
        <button className="truncate border-0 bg-transparent p-0 font-semibold text-inherit hover:underline" onClick={(e) => { e.stopPropagation(); openProfile(p.identity, serverId, e.clientX, e.clientY - 360) }}>{label}{p.isLocal ? ' (você)' : ''}</button>
        {p.quality !== 'unknown' && p.quality !== 'excellent' && <Signal size={12} className={p.quality === 'good' ? 'text-warning' : 'text-danger'} aria-label={`Conexão ${p.quality}`} />}
      </div>
      {kind === 'screen' && !p.isLocal && !notWatched && <button className="btn btn-sm absolute right-2 bottom-2" onClick={() => watch(null)}><MonitorOff size={13} /> Parar de assistir</button>}
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

export function ControlBar({ compact, music }: { compact?: boolean; music?: { enabled: boolean; open: boolean; toggle: () => void } }) {
  const { micMuted, deafened, camOn, screenOn, toggleMic, toggleDeafen, toggleCamera, leave, pttActive } = useVoice()
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
      <button className={clsx('icon-btn', compact ? '' : 'h-12 w-12 rounded-full', screenOn && 'active bg-[var(--bg-selected)] text-success')} onClick={requestScreenShare} disabled={!canShare} aria-pressed={screenOn} aria-label={screenOn ? 'Parar compartilhamento' : 'Compartilhar tela'} data-tip={!canShare ? 'Seu navegador não suporta compartilhamento de tela' : screenOn ? 'Parar compartilhamento' : 'Compartilhar tela'}>
        {screenOn ? <MonitorOff size={size} /> : <Monitor size={size} />}
      </button>
      {!compact && music && (
        <button className={clsx('icon-btn h-12 w-12 rounded-full', music.open && 'active bg-[var(--bg-selected)]')} onClick={music.toggle} disabled={!music.enabled} aria-pressed={music.open} aria-label="Música (Vibe Beats)" data-tip={music.enabled ? 'Música (Vibe Beats)' : 'O bot Vibe Beats está desligado. Quem administra liga em Configurações do servidor → Música.'}><Music size={size} /></button>
      )}
      {!compact && <button className="icon-btn h-12 w-12 rounded-full" onClick={() => open(<UserSettingsModal initialTab="voice" />)} aria-label="Configurações de voz" data-tip="Configurações de voz"><SettingsIcon size={size} /></button>}
      <button className={clsx('icon-btn', compact ? '' : 'h-12 w-14 rounded-full', 'bg-[var(--danger)] text-white hover:!bg-[var(--danger-hover)] hover:!text-white')} onClick={() => void leave()} aria-label="Sair da chamada" data-tip="Sair da chamada"><PhoneOff size={size} /></button>
    </div>
  )
}

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

const GAP = 8

/** Grade que ocupa toda a área, sem rolagem nem sobreposição (tamanho calculado a partir da área real). */
export function TileGrid({ items, w, h }: { items: { key: string; node: ReactNode }[]; w: number; h: number }) {
  const g = bestGrid(items.length, w, h, GAP)
  return (
    <div className="flex h-full w-full flex-wrap content-center items-center justify-center" style={{ gap: GAP }}>
      {items.map((it) => <div key={it.key} style={{ width: g.tw, height: g.th }} className="shrink-0">{it.node}</div>)}
    </div>
  )
}

function MoreTile({ n }: { n: number }) {
  return <div className="grid h-full w-full place-items-center rounded-xl bg-[var(--bg-secondary)] text-xl font-bold text-fg-2" aria-label={`Mais ${n} pessoas`}>+{n}</div>
}

/** Prioriza quem transmite, tem câmera ou está falando quando há mais blocos do que cabem. */
function capTiles(tiles: TileSpec[], max: number): { shown: TileSpec[]; more: number } {
  if (tiles.length <= max) return { shown: tiles, more: 0 }
  const rank = (t: TileSpec) => (t.kind === 'screen' ? 4 : 0) + (t.p.camOn ? 2 : 0) + (t.p.speaking ? 2 : 0) + (t.p.isLocal ? 1 : 0)
  const keep = new Set([...tiles].sort((a, b) => rank(b) - rank(a)).slice(0, max - 1).map((t) => t.key))
  return { shown: tiles.filter((t) => keep.has(t.key)), more: tiles.length - (max - 1) }
}
export function VoiceStage({ channel, serverId }: { channel: { id: string; name: string; server_id: string }; serverId: string }) {
  const { channelId, status, error, participants, focus, setFocus, join, retry, target, audioBlocked, enableAudio } = useVoice()
  const meId = useSession((s) => s.user?.id)
  const { data: members } = useMembers(serverId)
  const occupants = useVoiceOccupants()[channel.id] ?? []
  const joined = channelId === channel.id
  const settings = useSettings((s) => s.settings)
  const [showMusic, setShowMusic] = useState(false)
  const [areaRef, area] = useSize<HTMLDivElement>()
  const botOn = !!members?.some((m) => m.profile?.is_bot)
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
  const watching = useVoice((s) => s.watching)
  const spotlight = focusedTile ?? screenTiles.find((t) => t.identity === watching) ?? screenTiles.find((t) => t.p.isLocal) ?? undefined

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
    <div className="flex h-full min-h-0 bg-primary">
    <div className="flex min-w-0 flex-1 flex-col">
      {statusBanner && (
        <div className={clsx('flex items-center justify-center gap-3 px-4 py-2 text-sm', statusBanner.tone === 'err' ? 'bg-[var(--danger)] text-white' : statusBanner.tone === 'warn' ? 'bg-warning text-black' : 'bg-[var(--accent)] text-white')} role="status">
          {status !== 'failed' && <Loader2 size={14} className="spin" />}{statusBanner.text}
          {(status === 'failed' || status === 'reconnecting') && <button className="btn btn-sm" onClick={() => void retry()}><RefreshCw size={13} /> Tentar agora</button>}
        </div>
      )}
      {audioBlocked && status === 'connected' && (
        <div className="flex items-center justify-center gap-3 bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-contrast)]" role="status">
          O navegador bloqueou o som da chamada.
          <button className="btn btn-sm" onClick={() => void enableAudio()}><Volume2 size={13} /> Ativar áudio</button>
        </div>
      )}
      <div ref={areaRef} className="stage-dark min-h-0 flex-1 overflow-hidden p-2">
        {!participants.length ? (
          // nunca tela preta: enquanto a LiveKit não entrega a lista, mostra quem está na sala (presença) com o aviso de conexão
          <div className="relative h-full w-full">
            <TileGrid w={area.w} h={area.h} items={(occupants.length ? occupants : meId ? [meId] : []).map((id) => ({ key: id, node: <div className="grid h-full w-full place-items-center rounded-xl bg-[var(--bg-secondary)]"><Avatar path={memberOf(id)?.profile?.avatar_path} name={memberOf(id)?.profile?.display_name ?? '?'} id={id} size={80} /></div> }))} />
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"><span className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-1.5 text-sm text-white"><Loader2 size={14} className="spin" /> {status === 'failed' ? 'Sem conexão com a chamada' : 'Conectando à chamada…'}</span></div>
          </div>
        ) : spotlight ? (
          (() => {
            const side = area.w >= 820
            const sw = side ? 208 : 176
            const sh = Math.round(sw * 9 / 16)
            const cap = side ? Math.max(1, Math.floor((area.h + GAP) / (sh + GAP))) : Math.max(1, Math.floor((area.w + GAP) / (sw + GAP)))
            const { shown, more } = capTiles(others, cap)
            return (
              <div className={clsx('flex h-full w-full', side ? 'flex-row' : 'flex-col')} style={{ gap: GAP }}>
                <div className="min-h-0 min-w-0 flex-1"><VideoTile serverId={serverId} spec={spotlight} big member={memberOf(spotlight.identity)} focused={focus === spotlight.key} onFocus={() => setFocus(focus === spotlight.key ? null : spotlight.key)} /></div>
                {others.length > 0 && (
                  <div className={clsx('flex shrink-0 items-start overflow-hidden', side ? 'flex-col' : 'flex-row justify-center')} style={{ gap: GAP, ...(side ? { width: sw } : { height: sh }) }}>
                    {shown.map((t) => <div key={t.key} className="shrink-0" style={{ width: sw, height: sh }}><VideoTile serverId={serverId} spec={t} member={memberOf(t.identity)} focused={false} onFocus={() => setFocus(t.key)} /></div>)}
                    {more > 0 && <div className="shrink-0" style={{ width: sw, height: sh }}><MoreTile n={more} /></div>}
                  </div>
                )}
              </div>
            )
          })()
        ) : (
          (() => {
            const { shown, more } = capTiles(tiles, MAX_TILES)
            const items = [
              ...shown.map((t) => ({ key: t.key, node: <VideoTile serverId={serverId} spec={t} member={memberOf(t.identity)} focused={false} onFocus={() => setFocus(t.key)} /> })),
              ...(more > 0 ? [{ key: 'more', node: <MoreTile n={more} /> }] : []),
            ]
            return <TileGrid items={items} w={area.w} h={area.h} />
          })()
        )}
      </div>      <div className="flex flex-col items-center gap-2 border-t border-border bg-[var(--bg-secondary)] px-3 py-3">
        <ControlBar music={{ enabled: botOn, open: showMusic, toggle: () => setShowMusic((o) => !o) }} />
        <div className="text-[11px] text-fg-muted">
          {meId && participants.some((p) => p.isLocal && p.screenOn) && <span className="mr-3 text-success">● Você está transmitindo a tela</span>}
          {settings.voice.pttEnabled && <span>Push-to-talk: segure <kbd className="rounded bg-tertiary px-1">{codeLabel(settings.keybinds.pushToTalk)}</kbd></span>}
        </div>
      </div>
    </div>
    {showMusic && botOn && <div className="max-md:absolute max-md:inset-0 max-md:z-10"><MusicPanel channelId={channel.id} serverId={serverId} onClose={() => setShowMusic(false)} /></div>}
    </div>
  )
}
