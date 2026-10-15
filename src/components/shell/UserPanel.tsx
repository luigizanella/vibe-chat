import { useState } from 'react'
import { Circle, Headphones, HeadphoneOff, Mic, MicOff, Moon, MinusCircle, EyeOff, PhoneOff, Settings, SmilePlus, Signal, Monitor, Video } from 'lucide-react'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'
import { useVoice } from '@/store/voice'
import { setCustomStatus, setStatus } from '@/data/actions'
import { Avatar, Modal, PRESENCE_LABEL, Spinner, useCloseModal } from '@/components/ui'
import { UserSettingsModal } from '@/components/settings/UserSettings'
import { usePresenceOf } from '@/data/presence'
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
  const { status, target, participants, leave, retry } = useVoice()
  const servers = useServers().data
  if (!target || status === 'idle') return null
  const quality = participants.find((p) => p.isLocal)?.quality ?? 'unknown'
  const label = status === 'connected' ? 'Voz conectada' : status === 'connecting' ? 'Conectando…' : status === 'reconnecting' ? 'Reconectando…' : 'Falha na conexão'
  const color = status === 'connected' ? 'text-success' : status === 'failed' ? 'text-danger' : 'text-warning'
  return (
    <div className="border-b border-border bg-[var(--bg-tertiary)] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <Signal size={18} className={color} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-bold ${color}`}>{label}{status === 'connected' && quality !== 'unknown' && quality !== 'excellent' ? ` • ${quality === 'good' ? 'boa' : quality === 'poor' ? 'instável' : 'perdida'}` : ''}</div>
          <div className="truncate text-xs text-fg-2">{target.name} / {servers?.find((s) => s.id === target.serverId)?.name}</div>
        </div>
        {status === 'failed' && <button className="btn btn-sm" onClick={() => void retry()}>Tentar</button>}
        <button className="icon-btn" onClick={() => void leave()} aria-label="Desconectar da voz" data-tip="Desconectar"><PhoneOff size={18} /></button>
      </div>
      {status === 'connected' && <QuickControls />}
    </div>
  )
}

function QuickControls() {
  const { camOn, screenOn, toggleCamera, toggleScreen } = useVoice()
  return (
    <div className="mt-2 flex gap-1">
      <button className={`btn btn-sm flex-1 ${camOn ? 'btn-primary' : ''}`} onClick={() => void toggleCamera()} aria-pressed={camOn}><Video size={14} /> Vídeo</button>
      <button className={`btn btn-sm flex-1 ${screenOn ? 'btn-primary' : ''}`} onClick={() => void toggleScreen()} aria-pressed={screenOn}><Monitor size={14} /> Tela</button>
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
  const presence = usePresenceOf(profile?.id)
  if (!profile) return null
  const shown: Presence = profile.status_pref === 'invisible' ? 'offline' : presence === 'offline' ? (profile.status_pref as Presence) : presence
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
    <div className="flex h-[52px] shrink-0 items-center gap-1 bg-[var(--bg-rail)] px-2">
      <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md border-0 bg-transparent p-1 text-left hover:bg-[var(--bg-hover)]" onClick={statusMenu} aria-label={`Seu status: ${PRESENCE_LABEL[shown]}. Alterar`} data-tip="Alterar status" data-tip-side="top" aria-haspopup="menu">
        <Avatar path={profile.avatar_path} name={profile.display_name || profile.username} id={profile.id} size={32} status={shown} ring="var(--bg-rail)" />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold">{profile.display_name || profile.username}</span>
          <span className="block truncate text-[11px] text-fg-muted">{profile.custom_status || PRESENCE_LABEL[shown]}</span>
        </span>
      </button>
      <button className="icon-btn" onClick={() => void toggleMic()} disabled={!inCall} aria-pressed={micMuted} aria-label={micMuted ? 'Ativar microfone' : 'Silenciar microfone'} data-tip={!inCall ? 'Entre em um canal de voz para usar o microfone' : micMuted ? 'Ativar microfone' : 'Silenciar microfone'}>
        {micMuted && inCall ? <MicOff size={18} className="text-danger" /> : <Mic size={18} />}
      </button>
      <button className="icon-btn" onClick={() => void toggleDeafen()} disabled={!inCall} aria-pressed={deafened} aria-label={deafened ? 'Voltar a ouvir' : 'Ensurdecer'} data-tip={!inCall ? 'Entre em um canal de voz' : deafened ? 'Voltar a ouvir' : 'Ensurdecer'}>
        {deafened ? <HeadphoneOff size={18} className="text-danger" /> : <Headphones size={18} />}
      </button>
      <button className="icon-btn" onClick={() => openModal(<UserSettingsModal />)} aria-label="Configurações do usuário" data-tip="Configurações"><Settings size={18} /></button>
    </div>
  )
}
