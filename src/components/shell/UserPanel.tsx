import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Circle, Headphones, HeadphoneOff, Mic, MicOff, Moon, MinusCircle, EyeOff, PhoneOff, Settings, SmilePlus, Signal, Monitor, Video } from 'lucide-react'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'
import { useAfk } from '@/lib/idle'
import { useVoice } from '@/store/voice'
import { setCustomStatus, setStatus } from '@/data/actions'
import { Avatar, Modal, PRESENCE_LABEL, Spinner, useCloseModal } from '@/components/ui'
import { UserSettingsModal } from '@/components/settings/UserSettings'
import { requestScreenShare } from '@/components/voice/ScreenShareModal'
import { errorMessage } from '@/lib/errors'
import type { Presence, StatusPref } from '@/lib/types'
import { useServers } from '@/data/queries'

function CustomStatusModal() {
  const close = useCloseModal()
  const cur = useSession((s) => s.profile?.custom_status ?? '')
  const [text, setText] = useState(cur)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const save = async (v: string) => {
    setBusy(true)
    try {
      await setCustomStatus(v)
      close()
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal title="Definir status personalizado" footer={<><button className="btn btn-ghost" onClick={() => void save('')} disabled={busy}>Limpar</button><button className="btn btn-primary" onClick={() => void save(text)} disabled={busy}>{busy && <Spinner size={14} />} Salvar</button></>}>
      <div className="field"><label htmlFor="cs">O que você está fazendo?</label><input id="cs" className="input" maxLength={80} value={text} onChange={(e) => setText(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && void save(text)} /></div>
      {err && <p className="error-text mt-2">{err}</p>}
    </Modal>
  )
}

export function VoiceDock() {
  const { status, target, participants, leave, retry, ping } = useVoice()
  const servers = useServers().data
  const nav = useNavigate()
  if (!target || status === 'idle') return null
  const quality = participants.find((p) => p.isLocal)?.quality ?? 'unknown'
  const label = status === 'connected' ? 'Voz conectada' : status === 'connecting' ? 'Conectando…' : status === 'reconnecting' ? 'Reconectando…' : 'Falha na conexão'
  const color = status === 'connected' ? 'text-[var(--success-text)]' : status === 'failed' ? 'text-[var(--danger-text)]' : 'text-warning'
  return (
    <div className="border-b border-border bg-[var(--bg-tertiary)] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className={color} data-tip={ping !== null ? `Ping: ${ping} ms` : status === 'connected' ? 'Medindo ping…' : label} data-tip-side="top" tabIndex={0} aria-label={ping !== null ? `Ping: ${ping} milissegundos` : label}>
          <Signal size={20} aria-hidden />
        </span>
        <button className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left" onClick={() => nav(`/app/s/${target.serverId}/${target.id}`)} aria-label={`Voltar para a chamada ${target.name}`} data-tip="Voltar para a chamada" data-tip-side="top">
          <div className={`flex items-baseline gap-1 text-sm font-bold whitespace-nowrap ${color}`} title={status === 'connected' && quality !== 'unknown' ? `Qualidade da conexão: ${quality === 'excellent' ? 'ótima' : quality === 'good' ? 'boa' : quality === 'poor' ? 'instável' : 'perdida'}` : undefined}><span className="min-w-0 truncate">{label}</span>{status === 'connected' && ping !== null && <span className="shrink-0 text-right font-semibold tabular-nums">· {ping} ms</span>}</div>
          <div className="truncate text-xs text-fg-2 hover:underline">{target.name} / {servers?.find((s) => s.id === target.serverId)?.name}</div>
        </button>
        {status === 'failed' && <button className="btn btn-sm" onClick={() => void retry()}>Tentar</button>}
        <button className="icon-btn" onClick={() => void leave()} aria-label="Desconectar da voz" data-tip="Desconectar"><PhoneOff size={18} /></button>
      </div>
      {status === 'connected' && <QuickControls />}
    </div>
  )
}

function QuickControls() {
  const { camOn, screenOn, toggleCamera, micLevel, micOpen, micThreshold, micMuted } = useVoice()
  const level = micMuted ? 0 : micLevel
  return (
    <div className="mt-2">
      <div className="flex gap-1">
        <button className={`btn btn-sm flex-1 ${camOn ? 'btn-primary' : ''}`} onClick={() => void toggleCamera()} aria-pressed={camOn}><Video size={14} /> Vídeo</button>
        <button className={`btn btn-sm flex-1 ${screenOn ? 'btn-primary' : ''}`} onClick={requestScreenShare} aria-pressed={screenOn} disabled={typeof navigator.mediaDevices?.getDisplayMedia !== 'function'} title={typeof navigator.mediaDevices?.getDisplayMedia !== 'function' ? 'Este navegador não permite compartilhar a tela' : undefined}><Monitor size={14} /> {screenOn ? 'Parar' : 'Tela'}</button>
      </div>
      {screenOn && <div className="mt-1 text-xs font-semibold text-[var(--danger-text)]" role="status">● Você está transmitindo a tela</div>}
      <div className="mt-2">
        <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--bg-input)]" role="meter" aria-label="Nível do microfone enviado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level)}>
          <div className="h-full rounded-full" style={{ width: `${level}%`, background: micOpen ? 'var(--success)' : 'var(--text-muted)', transition: 'width 90ms linear' }} />
          {micThreshold > 0 && <div className="absolute top-0 h-full w-0.5 bg-[var(--text-primary)]" style={{ left: `${micThreshold}%` }} />}
        </div>
        <div className="mt-0.5 text-[10px] text-fg-muted">{micMuted ? 'Microfone silenciado' : micOpen ? 'Transmitindo voz' : 'Sem voz (filtrando ruído)'}</div>
      </div>
    </div>
  )
}
const STATUSES: { v: StatusPref; label: string; icon: React.ReactNode }[] = [
  { v: 'online', label: 'Online', icon: <Circle size={14} className="fill-[var(--presence-online)] text-[var(--presence-online)]" /> },
  { v: 'idle', label: 'Ausente', icon: <Moon size={14} className="fill-[var(--presence-idle)] text-[var(--presence-idle)]" /> },
  { v: 'dnd', label: 'Não perturbe', icon: <MinusCircle size={14} className="text-[var(--presence-dnd)]" /> },
  { v: 'invisible', label: 'Invisível', icon: <EyeOff size={14} className="text-[var(--presence-offline)]" /> },
]

export function UserPanel() {
  const profile = useSession((s) => s.profile)
  const openMenu = useUI((s) => s.openMenu)
  const openModal = useUI((s) => s.openModal)
  const { room, micMuted, deafened, toggleMic, toggleDeafen } = useVoice()
  const afk = useAfk((s) => s.active)
  if (!profile) return null
  // meu status vem do perfil (fonte da verdade), não da ida e volta da presença
  const shown: Presence = profile.status_pref === 'invisible' ? 'offline' : profile.status_pref === 'online' && afk ? 'idle' : (profile.status_pref as Presence)
  const inCall = !!room

  const statusMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    openMenu(r.left, r.top - 220, [
      ...STATUSES.map((s) => ({ label: s.label, icon: s.icon, onClick: () => void setStatus(s.v), hint: profile.status_pref === s.v ? '✓' : undefined })),
      { separator: true },
      { label: 'Definir status personalizado', icon: <SmilePlus size={14} />, onClick: () => openModal(<CustomStatusModal />) },
    ])
  }

  return (
    <div className="shrink-0 bg-[var(--bg-rail)] p-2">
      <div className="flex items-center gap-1 rounded-xl border border-border bg-[var(--bg-tertiary)] p-1.5">
        <button className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border-0 bg-transparent p-1 text-left hover:bg-[var(--bg-hover)]" onClick={statusMenu} aria-label={`Seu status: ${PRESENCE_LABEL[shown]}. Alterar`} data-tip="Alterar status" data-tip-side="top" aria-haspopup="menu">
          <Avatar path={profile.avatar_path} name={profile.display_name || profile.username} id={profile.id} size={40} status={shown} ring="var(--bg-tertiary)" />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[15px] font-bold">{profile.display_name || profile.username}</span>
            <span className="block truncate text-xs text-fg-2">{profile.custom_status || (inCall ? 'Em chamada' : PRESENCE_LABEL[shown])}</span>
          </span>
        </button>
        <button className="icon-btn h-9 w-9" onClick={() => void toggleMic()} disabled={!inCall} aria-pressed={micMuted} aria-label={micMuted ? 'Ativar microfone' : 'Silenciar microfone'} data-tip={!inCall ? 'Entre em um canal de voz para usar o microfone' : micMuted ? 'Ativar microfone' : 'Silenciar microfone'}>
          {micMuted && inCall ? <MicOff size={20} className="text-danger" /> : <Mic size={20} />}
        </button>
        <button className="icon-btn h-9 w-9" onClick={() => void toggleDeafen()} disabled={!inCall} aria-pressed={deafened} aria-label={deafened ? 'Voltar a ouvir' : 'Ensurdecer'} data-tip={!inCall ? 'Entre em um canal de voz' : deafened ? 'Voltar a ouvir' : 'Ensurdecer'}>
          {deafened ? <HeadphoneOff size={20} className="text-danger" /> : <Headphones size={20} />}
        </button>
        <button className="icon-btn h-9 w-9" onClick={() => openModal(<UserSettingsModal />)} aria-label="Configurações do usuário" data-tip="Configurações"><Settings size={20} /></button>
      </div>
    </div>  )
}
