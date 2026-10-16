import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, ChevronRight, FolderPlus, LogOut, Pencil, Plus, Settings, UserPlus } from 'lucide-react'
import clsx from 'clsx'
import { Layer } from '@/components/Layer'
import { hasPerm } from '@/lib/perms'
import { findPref, setNotifPref } from '@/data/actions'
import { useMembers, useNotifPrefs, usePermCtx } from '@/data/queries'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'
import { CategoryModal, ChannelModal, InviteModal } from '@/components/modals/ServerModals'
import { ConfirmLeaveServer, ServerSettingsModal } from '@/components/modals/ServerSettings'
import { NicknameModal } from '@/components/userMenu'

function Row({ label, icon, onClick, disabled, danger, trailing }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean; trailing?: ReactNode }) {
  return (
    <button role="menuitem" className={clsx('menu-item', danger && 'danger')} disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      <span className="flex items-center gap-1 opacity-80">{trailing}{icon}</span>
    </button>
  )
}

/** Popup do nome do servidor (camada única, ícones à direita). */
export function ServerMenu({ serverId, anchor, onClose }: { serverId: string; anchor: HTMLElement; onClose: () => void }) {
  const ctx = usePermCtx(serverId)
  const qc = useQueryClient()
  const me = useSession((s) => s.user?.id)
  const openModal = useUI((s) => s.openModal)
  const { data: prefs } = useNotifPrefs()
  const { data: members } = useMembers(serverId)
  const [notif, setNotif] = useState(false)
  if (!ctx) return null
  const muted = !!findPref(prefs, { server_id: serverId })?.muted
  const canManage = hasPerm(ctx, 'manage_channels')
  const myNick = members?.find((m) => m.user_id === me)?.nickname ?? ''
  const run = (fn: () => void) => () => { onClose(); fn() }

  return (
    <Layer anchor={anchor} placement="bottom-start" gap={4} onDismiss={onClose} role="menu" label={`Menu do servidor ${ctx.server.name}`}>
      <div className="menu w-[260px]">
        <Row label="Convidar pessoas" icon={<UserPlus size={16} />} disabled={!hasPerm(ctx, 'create_invite')} onClick={run(() => openModal(<InviteModal serverId={serverId} serverName={ctx.server.name} />))} />
        <Row label="Configurações do servidor" icon={<Settings size={16} />} onClick={run(() => openModal(<ServerSettingsModal serverId={serverId} />))} />
        <div className="menu-sep" />
        <Row label="Criar canal" icon={<Plus size={16} />} disabled={!canManage} onClick={run(() => openModal(<ChannelModal serverId={serverId} />))} />
        <Row label="Criar categoria" icon={<FolderPlus size={16} />} disabled={!canManage} onClick={run(() => openModal(<CategoryModal serverId={serverId} />))} />
        <div className="menu-sep" />
        <Row label="Editar apelido" icon={<Pencil size={16} />} onClick={run(() => me && openModal(<NicknameModal userId={me} serverId={serverId} isSelf current={myNick} name="" />))} />
        <Row label="Notificações" icon={muted ? <BellOff size={16} /> : <Bell size={16} />} trailing={<ChevronRight size={14} className={clsx('transition-transform', notif && 'rotate-90')} />} onClick={() => setNotif((v) => !v)} />
        {notif && (
          <div className="mb-1 ml-3 border-l border-border pl-1">
            <button role="menuitemradio" aria-checked={!muted} className="menu-item" onClick={() => { void setNotifPref(qc, { server_id: serverId }, { muted: false }); onClose() }}>
              <span>Todas as mensagens</span>{!muted && <span aria-hidden>●</span>}
            </button>
            <button role="menuitemradio" aria-checked={muted} className="menu-item" onClick={() => { void setNotifPref(qc, { server_id: serverId }, { muted: true }); onClose() }}>
              <span>Silenciar servidor</span>{muted && <span aria-hidden>●</span>}
            </button>
          </div>
        )}
        <div className="menu-sep" />
        <Row label="Sair do servidor" icon={<LogOut size={16} />} danger disabled={ctx.server.owner_id === me} onClick={run(() => openModal(<ConfirmLeaveServer serverId={serverId} name={ctx.server.name} />))} />
      </div>
    </Layer>
  )
}
