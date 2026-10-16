import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import clsx from 'clsx'
import { HeadphoneOff, Music, BellOff, Check, X, ChevronDown, ChevronRight, Hash, Lock, MicOff, Pencil, Plus, Settings, Trash2, UserPlus, Volume2, GripVertical, FolderPlus } from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { hasPerm } from '@/lib/perms'
import { qk, useCategories, useChannels, useMembers, useNotifPrefs, usePermCtx, useUnread } from '@/data/queries'
import { findPref, markChannelsRead, setNotifPref } from '@/data/actions'
import { useLiveUsers, useVoiceOccupants } from '@/data/presence'
import { MUSIC_BOT_ID, useServerMusic } from '@/data/music'
import { useVoiceMove } from '@/data/voiceMove'
import { useUI, toast } from '@/store/ui'
import { useVoice } from '@/store/voice'
import { Avatar, CenterSpinner, confirmAction } from '@/components/ui'
import { CategoryModal, ChannelModal, InviteModal } from '@/components/modals/ServerModals'
import type { Category, Channel } from '@/lib/types'
import { UserPanel, VoiceDock } from './UserPanel'
import { ServerMenu } from './ServerMenu'
import { useLocalNick, useUserMenu } from '@/components/userMenu'

const COLLAPSE_KEY = 'vibe.collapsed'
function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

interface Section {
  id: string | null
  name: string
  channels: Channel[]
}

function ChannelItem({ ch, active, unread, mentions, muted, canManage, onOpen, onContext, serverId }: {
  ch: Channel; active: boolean; unread: boolean; mentions: number; muted: boolean; canManage: boolean; onOpen: () => void; onContext: (e: React.MouseEvent) => void; serverId: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ch.id, data: { type: 'chan', category: ch.category_id }, disabled: !canManage })
  const occupants = useVoiceOccupants()[ch.id] ?? []
  const { data: members } = useMembers(serverId)
  const participants = useVoice((s) => s.participants)
  const voiceChannel = useVoice((s) => s.channelId)
  const openModal = useUI((s) => s.openModal)
  const openProfile = useUI((s) => s.openProfile)
  const userMenu = useUserMenu(serverId)
  const localNick = useLocalNick()
  const mv = useVoiceMove(serverId)
  const liveUsers = useLiveUsers()
  const joinVoice = useVoice((s) => s.join)
  const nav = useNavigate()
  const { data: sessions } = useServerMusic(ch.kind === 'voice' ? serverId : undefined)
  const playing = sessions?.find((x) => x.channel_id === ch.id && x.status !== 'idle')
  const Icon = ch.kind === 'voice' ? Volume2 : ch.is_private ? Lock : Hash
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }} className={clsx(mv.overId === ch.id && 'rounded-md bg-[var(--bg-selected)] ring-2 ring-[var(--accent)]')} {...mv.dropProps(ch)}>
      <div className="group relative mb-0.5" onContextMenu={onContext}>
        <button
          {...attributes}
          {...listeners}
          onClick={onOpen}
          aria-current={active ? 'page' : undefined}
          className={clsx('flex w-full items-center gap-1.5 min-h-[34px] rounded-md border-0 px-2.5 py-1.5 text-left', active ? 'bg-[var(--bg-selected)] text-fg' : 'bg-transparent hover:bg-[var(--bg-hover)]', unread && !active && !muted ? 'font-bold text-fg' : muted ? 'text-fg-muted' : 'text-fg-2')}
        >
          <Icon size={18} className="shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{ch.name}</span>
          {mentions > 0 && !muted && <span className="badge">{mentions}</span>}
          {muted && <BellOff size={12} aria-label="Silenciado" />}
        </button>
        {canManage && (
          <div className="absolute top-1/2 right-1 hidden -translate-y-1/2 gap-0.5 group-hover:flex group-focus-within:flex">
            <button className="icon-btn h-5 w-5" aria-label={`Editar ${ch.name}`} data-tip="Editar canal" onClick={(e) => { e.stopPropagation(); openModal(<ChannelModal serverId={serverId} channel={ch} />) }}><Settings size={13} /></button>
          </div>
        )}
        {unread && !active && !muted && <span className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r bg-[var(--text-primary)]" aria-hidden />}
      </div>
      {ch.kind === 'voice' && (occupants.length > 0 || playing) && (
        <ul className="m-0 mb-1.5 list-none p-0 pl-8">
          {playing && (
            <li title={playing.title ?? undefined}>
              <button className="flex h-8 w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-fg-2 hover:bg-[var(--bg-hover)]" onClick={(e) => openProfile(MUSIC_BOT_ID, serverId, e.clientX + 12, e.clientY - 20)}>
                <Avatar path="app:logo" name="Vibe Beats" id="vibe-beats" size={24} />
                <span className="min-w-0 flex-1 truncate">Vibe Beats</span>
                <span className="rounded bg-[var(--accent)] px-1 text-[10px] leading-4 font-bold text-[var(--accent-contrast)]">APP</span>
                <Music size={13} className="shrink-0 text-fg-muted" aria-label="Tocando música" />
              </button>
            </li>
          )}
          {occupants.map((uid) => {
            const m = members?.find((x) => x.user_id === uid)
            const live = voiceChannel === ch.id ? participants.find((p) => p.identity === uid) : undefined
            const name = localNick(uid, m?.nickname || m?.profile?.display_name || m?.profile?.username || 'Membro')
            return (
              <li key={uid} onContextMenu={(e) => userMenu(uid, e)} {...mv.dragProps(uid)}>
                <button className="flex h-8 w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-fg-2 hover:bg-[var(--bg-hover)]" onClick={(e) => openProfile(uid, serverId, e.clientX + 12, e.clientY - 20)}>
                <Avatar path={m?.profile?.avatar_path} name={name} id={uid} size={24} speaking={!!live?.speaking} />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {liveUsers.has(uid) && (
                  <span role="button" tabIndex={0} className="shrink-0 cursor-pointer rounded bg-[var(--danger)] px-1 text-[10px] leading-4 font-bold text-white" data-tip="Assistir transmissão" onClick={(e) => { e.stopPropagation(); nav(`/app/s/${serverId}/${ch.id}`); if (voiceChannel === ch.id) useVoice.getState().watch(uid); else void joinVoice({ id: ch.id, serverId, name: ch.name }, uid) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.click() }}>AO VIVO</span>
                )}
                {m?.voice_deafened && <HeadphoneOff size={14} className="text-[var(--danger-text)]" aria-label="Áudio desativado por um moderador" />}
                {m?.voice_muted ? <MicOff size={14} className="text-[var(--danger-text)]" aria-label="Silenciado por um moderador" /> : live && !live.micOn && <MicOff size={14} className="text-fg-muted" aria-label="Microfone desligado" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function CategoryHeader({ section, collapsed, canManage, onToggle, onContext, onAdd }: { section: Section; collapsed: boolean; canManage: boolean; onToggle: () => void; onContext: (e: React.MouseEvent) => void; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `cat:${section.id}`, data: { type: 'cat' }, disabled: !canManage })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }} className="group/cat mt-6 mb-1.5 flex items-center pr-1" onContextMenu={onContext}>
      {canManage && <span {...attributes} {...listeners} className="cursor-grab text-fg-muted opacity-0 group-hover/cat:opacity-100" aria-label={`Arrastar categoria ${section.name}`} role="button" tabIndex={0}><GripVertical size={12} /></span>}
      <button className="flex min-w-0 flex-1 items-center gap-0.5 border-0 bg-transparent px-1 text-left text-[13px] font-semibold text-fg-muted hover:text-fg" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<span className="truncate">{section.name}</span>
      </button>
      {canManage && <button className="icon-btn h-5 w-5 text-fg-muted" aria-label={`Criar canal em ${section.name}`} data-tip="Criar canal" onClick={onAdd}><Plus size={14} /></button>}
    </div>
  )
}

export function ChannelSidebar({ serverId }: { serverId: string }) {
  const { channelId } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const ctx = usePermCtx(serverId)
  const { data: channels, isLoading } = useChannels(serverId)
  const { data: categories } = useCategories(serverId)
  const { data: unread } = useUnread()
  const { data: prefs } = useNotifPrefs()
  const joinVoice = useVoice((s) => s.join)
  const openModal = useUI((s) => s.openModal)
  const openMenu = useUI((s) => s.openMenu)
  const setMobilePane = useUI((s) => s.setMobilePane)
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const menuClosedAt = useRef(0)
  const canManage = hasPerm(ctx, 'manage_channels')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const sections = useMemo<Section[]>(() => {
    const cats = [...(categories ?? [])].sort((a, b) => a.position - b.position)
    const by = (cid: string | null) => (channels ?? []).filter((c) => c.category_id === cid).sort((a, b) => a.position - b.position)
    const orphan = by(null)
    return [...(orphan.length ? [{ id: null, name: '', channels: orphan }] : []), ...cats.map((c) => ({ id: c.id, name: c.name, channels: by(c.id) }))]
  }, [channels, categories])

  if (!ctx || isLoading) return <div className="flex h-full flex-col bg-secondary"><div className="flex-1"><CenterSpinner /></div><UserPanel /></div>
  const server = ctx.server
  const toggle = (id: string) => setCollapsed((c) => {
    const n = { ...c, [id]: !c[id] }
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(n)) } catch { /* sem storage */ }
    return n
  })

  const open = (ch: Channel) => {
    nav(`/app/s/${serverId}/${ch.id}`)
    setMobilePane('main')
    if (ch.kind === 'voice' && useVoice.getState().channelId !== ch.id) void joinVoice({ id: ch.id, serverId, name: ch.name })
  }

  const channelMenu = (ch: Channel) => (e: React.MouseEvent) => {
    e.preventDefault()
    const pref = findPref(prefs, { channel_id: ch.id })
    openMenu(e.clientX, e.clientY, [
      { label: 'Marcar como lido', icon: <Check size={14} />, onClick: () => void markChannelsRead(qc, [ch]), disabled: ch.kind !== 'text' },
      { label: pref?.muted ? 'Reativar notificações' : 'Silenciar canal', icon: <BellOff size={14} />, onClick: () => void setNotifPref(qc, { channel_id: ch.id }, { muted: !pref?.muted }) },
      ...(canManage ? [
        { separator: true },
        { label: 'Editar canal', icon: <Pencil size={14} />, onClick: () => openModal(<ChannelModal serverId={serverId} channel={ch} />) },
        { label: 'Excluir canal', icon: <Trash2 size={14} />, danger: true, onClick: () => confirmAction({ title: `Excluir ${ch.kind === 'text' ? '#' : ''}${ch.name}`, message: 'Todas as mensagens deste canal serão apagadas permanentemente.', confirmLabel: 'Excluir canal', danger: true, onConfirm: async () => { await rpc('delete_channel', { p_channel: ch.id }); await qc.invalidateQueries({ queryKey: qk.channels(serverId) }); if (ch.id === channelId) nav(`/app/s/${serverId}`) } }) },
      ] : []),
    ])
  }

  const categoryMenu = (s: Section) => (e: React.MouseEvent) => {
    if (!s.id || !canManage) return
    e.preventDefault()
    openMenu(e.clientX, e.clientY, [
      { label: 'Criar canal', icon: <Plus size={14} />, onClick: () => openModal(<ChannelModal serverId={serverId} defaultCategory={s.id} />) },
      { label: 'Renomear categoria', icon: <Pencil size={14} />, onClick: () => openModal(<CategoryModal serverId={serverId} category={{ id: s.id!, name: s.name }} />) },
      { separator: true },
      { label: 'Excluir categoria', icon: <Trash2 size={14} />, danger: true, onClick: () => confirmAction({ title: `Excluir categoria “${s.name}”`, message: 'Os canais dentro dela ficarão sem categoria.', confirmLabel: 'Excluir', danger: true, onConfirm: async () => { await rpc('delete_category', { p_category: s.id }); await qc.invalidateQueries({ queryKey: qk.categories(serverId) }); await qc.invalidateQueries({ queryKey: qk.channels(serverId) }) } }) },
    ])
  }

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const aType = active.data.current?.type as 'cat' | 'chan'
    const oType = over.data.current?.type as 'cat' | 'chan'
    const prevChannels = qc.getQueryData<Channel[]>(qk.channels(serverId)) ?? []
    const prevCats = qc.getQueryData<Category[]>(qk.categories(serverId)) ?? []
    let nextCats = prevCats
    let nextChans = prevChannels
    const catIds = sections.filter((s) => s.id).map((s) => s.id as string)

    if (aType === 'cat' && oType === 'cat') {
      const from = catIds.indexOf(String(active.id).slice(4))
      const to = catIds.indexOf(String(over.id).slice(4))
      if (from < 0 || to < 0) return
      const order = arrayMove(catIds, from, to)
      nextCats = prevCats.map((c) => ({ ...c, position: order.indexOf(c.id) }))
    } else if (aType === 'chan') {
      const moving = prevChannels.find((c) => c.id === active.id)
      if (!moving) return
      const targetCat: string | null = oType === 'cat' ? (String(over.id).slice(4) || null) : ((over.data.current?.category as string | null) ?? null)
      const targetList = sections.find((s) => s.id === targetCat)?.channels.filter((c) => c.id !== moving.id) ?? []
      let index = oType === 'chan' ? targetList.findIndex((c) => c.id === over.id) : targetList.length
      if (oType === 'chan' && moving.category_id === targetCat) {
        const srcIdx = (sections.find((s) => s.id === targetCat)?.channels ?? []).findIndex((c) => c.id === moving.id)
        const overIdx = (sections.find((s) => s.id === targetCat)?.channels ?? []).findIndex((c) => c.id === over.id)
        index = overIdx > srcIdx ? index + 1 : index
      }
      targetList.splice(Math.max(0, index), 0, { ...moving, category_id: targetCat })
      const positions = new Map(targetList.map((c, i) => [c.id, i]))
      nextChans = prevChannels.map((c) => (c.id === moving.id ? { ...c, category_id: targetCat, position: positions.get(c.id)! } : positions.has(c.id) ? { ...c, position: positions.get(c.id)! } : c))
    } else return

    qc.setQueryData(qk.categories(serverId), nextCats)
    qc.setQueryData(qk.channels(serverId), nextChans)
    try {
      await rpc('reorder_layout', {
        p_server: serverId,
        p_categories: nextCats.map((c) => ({ id: c.id, position: c.position })),
        p_channels: nextChans.map((c) => ({ id: c.id, category_id: c.category_id, position: c.position })),
      })
    } catch (err) {
      toast.error(errorMessage(err))
      qc.setQueryData(qk.categories(serverId), prevCats)
      qc.setQueryData(qk.channels(serverId), prevChannels)
    }
  }

  const emptyMenu = (e: React.MouseEvent) => {
    if (e.defaultPrevented) return
    e.preventDefault()
    openMenu(e.clientX, e.clientY, [
      { label: 'Criar canal', icon: <Plus size={14} />, disabled: !canManage, onClick: () => openModal(<ChannelModal serverId={serverId} />) },
      { label: 'Criar categoria', icon: <FolderPlus size={14} />, disabled: !canManage, onClick: () => openModal(<CategoryModal serverId={serverId} />) },
      { separator: true },
      { label: 'Convidar pessoas', icon: <UserPlus size={14} />, disabled: !hasPerm(ctx, 'create_invite'), onClick: () => openModal(<InviteModal serverId={serverId} serverName={server.name} />) },
    ])
  }

  const unreadMap = new Map((unread ?? []).filter((u) => u.channel_id).map((u) => [u.channel_id!, u]))

  return (
    <div className="flex h-full min-h-0 flex-col bg-secondary">
      <button className="flex h-12 shrink-0 items-center justify-between border-0 border-b border-border bg-transparent px-4 font-bold shadow-sm hover:bg-[var(--bg-hover)]" onClick={(e) => { const b = e.currentTarget; if (Date.now() - menuClosedAt.current < 250) return; setMenuAnchor(b) }} aria-haspopup="menu" aria-expanded={!!menuAnchor} aria-label={`Menu do servidor ${server.name}`}>
        <span className="truncate">{server.name}</span>{menuAnchor ? <X size={16} /> : <ChevronDown size={16} />}
      </button>
      {menuAnchor && <ServerMenu serverId={serverId} anchor={menuAnchor} onClose={() => { menuClosedAt.current = Date.now(); setMenuAnchor(null) }} />}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-4" onContextMenu={emptyMenu}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
          <SortableContext items={sections.filter((s) => s.id).map((s) => `cat:${s.id}`)} strategy={verticalListSortingStrategy}>
            {sections.map((s) => {
              const isCollapsed = !!s.id && !!collapsed[s.id]
              const visible = isCollapsed ? s.channels.filter((c) => c.id === channelId || unreadMap.get(c.id)) : s.channels
              return (
                <div key={s.id ?? 'orphans'}>
                  {s.id ? <CategoryHeader section={s} collapsed={isCollapsed} canManage={canManage} onToggle={() => toggle(s.id!)} onContext={categoryMenu(s)} onAdd={() => openModal(<ChannelModal serverId={serverId} defaultCategory={s.id} />)} /> : <div className="h-2" />}
                  <SortableContext items={visible.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    {visible.map((ch) => {
                      const u = unreadMap.get(ch.id)
                      const muted = !!findPref(prefs, { channel_id: ch.id })?.muted || !!findPref(prefs, { server_id: serverId })?.muted
                      return <ChannelItem key={ch.id} ch={ch} serverId={serverId} active={ch.id === channelId} unread={!!u} mentions={u?.mention_count ?? 0} muted={muted} canManage={canManage} onOpen={() => open(ch)} onContext={channelMenu(ch)} />
                    })}
                  </SortableContext>
                  {!s.channels.length && s.id && !isCollapsed && <div className="px-3 py-1 text-xs text-fg-muted">Categoria vazia{canManage ? ' — arraste canais para cá' : ''}</div>}
                </div>
              )
            })}
          </SortableContext>
        </DndContext>
        {!channels?.length && <div className="p-4 text-center text-fg-muted">Este servidor ainda não tem canais.{canManage && <div className="mt-2"><button className="btn btn-sm btn-primary" onClick={() => openModal(<ChannelModal serverId={serverId} />)}>Criar canal</button></div>}</div>}
      </div>
      <VoiceDock />
      <UserPanel />
    </div>
  )
}
