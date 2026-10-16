import { useMemo } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { BellOff, Check, Compass, HelpCircle, LogOut, Plus, Settings, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useUI } from '@/store/ui'
import { markChannelsRead, setNotifPref, findPref } from '@/data/actions'
import { qk, useNotifPrefs, useServers, useUnread } from '@/data/queries'
import type { Channel, Server } from '@/lib/types'
import { Avatar } from '@/components/ui'
import { CreateServerModal, InviteModal } from '@/components/modals/ServerModals'
import { ServerSettingsModal, ConfirmLeaveServer } from '@/components/modals/ServerSettings'
import { useSession } from '@/store/session'

function RailItem({ active, tip, to, onContext, children, indicator, badge }: { active?: boolean; tip: string; to: string; onContext?: (e: React.MouseEvent) => void; children: React.ReactNode; indicator?: 'unread' | 'none'; badge?: number }) {
  return (
    <div className="group relative flex w-full justify-center" onContextMenu={onContext}>
      <span
        className={clsx('absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-[var(--text-primary)] transition-[height] duration-150', active ? 'h-10' : indicator === 'unread' ? 'h-2 group-hover:h-5' : 'h-0 group-hover:h-5')}
        aria-hidden
      />
      <NavLink to={to} className="relative block outline-offset-2" aria-label={tip} data-tip={tip} data-tip-side="right" aria-current={active ? 'page' : undefined}>
        {children}
        {!!badge && <span className="badge absolute -right-1 -bottom-1 ring-[3px] ring-[var(--bg-rail)]">{badge > 99 ? '99+' : badge}</span>}
      </NavLink>
    </div>
  )
}

const railBtn = 'grid h-14 w-14 shrink-0 place-items-center rounded-[24px] border-0 bg-[var(--bg-primary)] text-[var(--success-text)] transition-all duration-150 hover:rounded-[16px] hover:bg-[var(--success)] hover:text-white'
export function ServerRail({ onHelp }: { onHelp: () => void }) {
  const { serverId } = useParams()
  const qc = useQueryClient()
  const me = useSession((s) => s.user?.id)
  const { data: servers } = useServers()
  const { data: unread } = useUnread()
  const { data: prefs } = useNotifPrefs()
  const openModal = useUI((s) => s.openModal)
  const openMenu = useUI((s) => s.openMenu)

  const chanQueries = useQueries({
    queries: (servers ?? []).map((s) => ({
      queryKey: qk.channels(s.id),
      queryFn: async () => ((await supabase.from('channels').select('*').eq('server_id', s.id).order('position')).data ?? []) as Channel[],
    })),
  })
  const channelsByServer = useMemo(() => {
    const m = new Map<string, Channel[]>()
    servers?.forEach((s, i) => m.set(s.id, chanQueries[i]?.data ?? []))
    return m
  }, [servers, chanQueries])

  const summary = useMemo(() => {
    const out = new Map<string, { unread: number; mentions: number }>()
    let dmUnread = 0
    for (const u of unread ?? []) {
      if (u.dm_id) {
        const p = findPref(prefs, { dm_id: u.dm_id })
        if (!p?.muted) dmUnread += u.mention_count || u.unread_count
        continue
      }
      for (const [sid, chans] of channelsByServer) {
        if (!chans.some((c) => c.id === u.channel_id)) continue
        const chanPref = findPref(prefs, { channel_id: u.channel_id! })
        const srvPref = findPref(prefs, { server_id: sid })
        if (chanPref?.muted || srvPref?.muted) continue
        const level = chanPref?.level ?? srvPref?.level ?? 'all'
        const cur = out.get(sid) ?? { unread: 0, mentions: 0 }
        if (level === 'all' || u.mention_count > 0) cur.unread += u.unread_count
        cur.mentions += level === 'none' ? 0 : u.mention_count
        out.set(sid, cur)
      }
    }
    return { out, dmUnread }
  }, [unread, prefs, channelsByServer])

  const serverMenu = (s: Server) => (e: React.MouseEvent) => {
    e.preventDefault()
    const chans = channelsByServer.get(s.id) ?? []
    const muted = findPref(prefs, { server_id: s.id })?.muted
    const isOwner = s.owner_id === me
    openMenu(e.clientX, e.clientY, [
      { label: 'Marcar como lido', icon: <Check size={14} />, onClick: () => void markChannelsRead(qc, chans) },
      { label: muted ? 'Reativar notificações' : 'Silenciar servidor', icon: <BellOff size={14} />, onClick: () => void setNotifPref(qc, { server_id: s.id }, { muted: !muted }) },
      { separator: true },
      { label: 'Convidar pessoas', icon: <UserPlus size={14} />, onClick: () => openModal(<InviteModal serverId={s.id} serverName={s.name} />) },
      { label: 'Configurações do servidor', icon: <Settings size={14} />, onClick: () => openModal(<ServerSettingsModal serverId={s.id} />) },
      { separator: true },
      { label: 'Sair do servidor', icon: <LogOut size={14} />, danger: true, disabled: isOwner, hint: isOwner ? 'dono' : undefined, onClick: () => openModal(<ConfirmLeaveServer serverId={s.id} name={s.name} />) },
    ])
  }

  const homeActive = !serverId

  return (
    <nav className="flex h-full flex-col items-center gap-3 overflow-y-auto overflow-x-hidden bg-[var(--bg-rail)] py-4" aria-label="Servidores" style={{ scrollbarWidth: 'none' }}>
      <RailItem to="/app/@me" tip="Mensagens diretas" active={homeActive} badge={summary.dmUnread}>
        <span className={clsx('grid h-14 w-14 place-items-center bg-[var(--bg-primary)] transition-[border-radius,background] duration-150', homeActive ? 'rounded-[16px] bg-[var(--bg-elevated)]' : 'rounded-[24px] group-hover:rounded-[16px] group-hover:bg-[var(--bg-elevated)]')}><img src="/logo.png" alt="Início" draggable={false} className="h-9 w-9 object-contain" /></span>
      </RailItem>
      <div className="h-0.5 w-8 shrink-0 rounded bg-[var(--border-strong)]" />
      {servers?.map((s) => {
        const sm = summary.out.get(s.id)
        const active = s.id === serverId
        return (
          <RailItem key={s.id} to={`/app/s/${s.id}`} tip={s.name} active={active} onContext={serverMenu(s)} indicator={sm?.unread ? 'unread' : 'none'} badge={sm?.mentions}>
            <Avatar path={s.icon_path} name={s.name} id={s.id} size={56} square className={clsx('[&>span]:transition-[border-radius] [&>span]:duration-150', active ? '[&>span]:!rounded-[16px]' : '[&>span]:!rounded-[24px] group-hover:[&>span]:!rounded-[16px]')} />
          </RailItem>
        )
      })}
      <button className={railBtn} onClick={() => openModal(<CreateServerModal />)} aria-label="Adicionar um servidor" data-tip="Adicionar um servidor" data-tip-side="right"><Plus size={24} /></button>
      <button className={railBtn} onClick={() => openModal(<CreateServerModal initialTab="join" />)} aria-label="Entrar com um convite" data-tip="Entrar com um convite" data-tip-side="right"><Compass size={22} /></button>
      <div className="mt-auto flex flex-col items-center gap-1 pt-2">
          <button className="icon-btn" onClick={onHelp} aria-label="Ajuda e atalhos" data-tip="Ajuda e atalhos (Ctrl+/)" data-tip-side="right"><HelpCircle size={20} /></button>
      </div>
    </nav>
  )
}