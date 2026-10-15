import { useMemo } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { BellOff, Check, Compass, LogOut, MessageCircle, Plus, Settings, UserPlus } from 'lucide-react'
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
    <div className="relative flex w-full justify-center" onContextMenu={onContext}>
      <span className={clsx('absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r bg-white transition-all', active ? 'h-10' : indicator === 'unread' ? 'h-2' : 'h-0')} aria-hidden />
      <NavLink to={to} className="relative block rounded-[24px] outline-offset-2 transition-[border-radius] duration-150 hover:rounded-[16px]" style={{ borderRadius: active ? 16 : undefined }} aria-label={tip} data-tip={tip} data-tip-side="right" aria-current={active ? 'page' : undefined}>
        {children}
        {!!badge && <span className="badge absolute -right-1 -bottom-1 ring-[3px] ring-[var(--bg-rail)]">{badge > 99 ? '99+' : badge}</span>}
      </NavLink>
    </div>
  )
}

export function ServerRail() {
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
    <nav className="flex h-full flex-col items-center gap-2 overflow-y-auto overflow-x-hidden bg-[var(--bg-rail)] py-3 max-md:w-[72px]" aria-label="Servidores" style={{ scrollbarWidth: 'none' }}>
      <RailItem to="/app/@me" tip="Mensagens diretas" active={homeActive} badge={summary.dmUnread}>
        <span className={clsx('grid h-12 w-12 place-items-center text-white transition-colors', homeActive ? 'rounded-2xl bg-accent' : 'rounded-[24px] bg-[var(--bg-primary)] hover:rounded-2xl hover:bg-accent')}><MessageCircle size={24} /></span>
      </RailItem>
      <div className="h-0.5 w-8 rounded bg-[var(--border-strong)]" />
      {servers?.map((s) => {
        const sm = summary.out.get(s.id)
        const active = s.id === serverId
        return (
          <RailItem key={s.id} to={`/app/s/${s.id}`} tip={s.name} active={active} onContext={serverMenu(s)} indicator={sm?.unread ? 'unread' : 'none'} badge={sm?.mentions}>
            <Avatar path={s.icon_path} name={s.name} id={s.id} size={48} square className={clsx('transition-[border-radius]', active ? '[&>span]:!rounded-2xl' : '[&>span]:!rounded-[24px] hover:[&>span]:!rounded-2xl')} />
          </RailItem>
        )
      })}
      <button className="grid h-12 w-12 shrink-0 place-items-center rounded-[24px] border-0 bg-[var(--bg-primary)] text-success transition-all hover:rounded-2xl hover:bg-success hover:text-white" onClick={() => openModal(<CreateServerModal />)} aria-label="Adicionar um servidor" data-tip="Adicionar um servidor" data-tip-side="right"><Plus size={24} /></button>
      <button className="grid h-12 w-12 shrink-0 place-items-center rounded-[24px] border-0 bg-[var(--bg-primary)] text-success transition-all hover:rounded-2xl hover:bg-success hover:text-white" onClick={() => openModal(<CreateServerModal initialTab="join" />)} aria-label="Entrar com um convite" data-tip="Entrar com um convite" data-tip-side="right"><Compass size={22} /></button>
    </nav>
  )
}
