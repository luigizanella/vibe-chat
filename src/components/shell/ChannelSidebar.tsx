import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import clsx from 'clsx'
import { BellOff, Check, ChevronDown, ChevronRight, Hash, LogOut, Lock, MicOff, Pencil, Plus, Settings, Trash2, UserPlus, Volume2, GripVertical, FolderPlus } from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { hasPerm } from '@/lib/perms'
import { qk, useCategories, useChannels, useMembers, useNotifPrefs, usePermCtx, useUnread } from '@/data/queries'
import { findPref, markChannelsRead, setNotifPref } from '@/data/actions'
import { useVoiceOccupants } from '@/data/presence'
import { useUI, toast } from '@/store/ui'
import { useVoice } from '@/store/voice'
import { useSession } from '@/store/session'
import { Avatar, CenterSpinner, confirmAction } from '@/components/ui'
import { CategoryModal, ChannelModal, InviteModal } from '@/components/modals/ServerModals'
import { ConfirmLeaveServer, ServerSettingsModal } from '@/components/modals/ServerSettings'
import type { Category, Channel } from '@/lib/types'
import { UserPanel, VoiceDock } from './UserPanel'

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
  const Icon = ch.kind === 'voice' ? Volume2 : ch.is_private ? Lock : Hash
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
      <div className="group relative" onContextMenu={onContext}>
        <button
          {...attributes}
          {...listeners}
          onClick={onOpen}
          aria-current={active ? 'page' : undefined}
          className={clsx('flex w-full items-center gap-1.5 rounded-md border-0 px-2 py-[5px] text-left', active ? 'bg-[var(--bg-selected)] text-fg' : 'bg-transparent hover:bg-[var(--bg-hover)]', unread && !active && !muted ? 'font-bold text-fg' : muted ? 'text-fg-muted' : 'text-fg-2')}
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
        {unread && !active && !muted && <span className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r bg-white" aria-hidden />}
      </div>
      {ch.kind === 'voice' && occupants.length > 0 && (
        <ul className="m-0 mb-1 list-none p-0 pl-7">
          {occupants.map((uid) => {
            const m = members?.find((x) => x.user_id === uid)
            const live = voiceChannel === ch.id ? participants.find((p) => p.identity === uid) : undefined
            const name = m?.nickname || m?.profile?.display_name || m?.profile?.username || 'Membro'
            return (
              <li key={uid} className="flex items-center gap-2 rounded px-1 py-0.5 text-fg-2">
                <span className={clsx('rounded-full', live?.speaking && 'shadow-[0_0_0_2px_var(--success)]')}><Avatar path={m?.profile?.avatar_path} name={name} id={uid} size={20} /></span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{name}</span>
                {live && !live.micOn && <MicOff size={12} className="text-fg-muted" aria-label="Microfone desligado" />}
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
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }} className="group/cat mt-3 flex items-center pr-1" onContextMenu={onContext}>
      {canManage && <span {...attributes} {...listeners} className="cursor-grab text-fg-muted opacity-0 group-hover/cat:opacity-100" aria-label={`Arrastar categoria ${section.name}`} role="button" tabIndex={0}><GripVertical size={12} /></span>}
      <button className="flex min-w-0 flex-1 items-center gap-0.5 border-0 bg-transparent px-1 text-left text-xs font-bold tracking-wide text-fg-muted uppercase hover:text-fg" onClick={onToggle} aria-expanded={!collapsed}>
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
  const me = useSession((s) => s.user?.id)
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

  const headerMenu = (ev: React.MouseEvent) => {
    const r = ev.currentTarget.getBoundingClientRect()
    const muted = findPref(prefs, { server_id: serverId })?.muted
    openMenu(r.left + 8, r.bottom + 4, [
      { label: 'Convidar pessoas', icon: <UserPlus size={14} />, onClick: () => openModal(<InviteModal serverId={serverId} serverName={server.name} />), disabled: !hasPerm(ctx, 'create_invite') },
      { label: 'Configurações do servidor', icon: <Settings size={14} />, onClick: () => openModal(<ServerSettingsModal serverId={serverId} />) },
      { separator: true },
      { label: 'Criar canal', icon: <Plus size={14} />, onClick: () => openModal(<ChannelModal serverId={serverId} />), disabled: !canManage },
      { label: 'Criar categoria', icon: <FolderPlus size={14} />, onClick: () => openModal(<CategoryModal serverId={serverId} />), disabled: !canManage },
      { separator: true },
      { label: muted ? 'Reativar notificações' : 'Silenciar servidor', icon: <BellOff size={14} />, onClick: () => void setNotifPref(qc, { server_id: serverId }, { muted: !muted }) },
      { label: 'Sair do servidor', icon: <LogOut size={14} />, danger: true, disabled: server.owner_id === me, onClick: () => openModal(<ConfirmLeaveServer serverId={serverId} name={server.name} />) },
    ])
  }

  const unreadMap = new Map((unread ?? []).filter((u) => u.channel_id).map((u) => [u.channel_id!, u]))

  return (
    <div className="flex h-full min-h-0 flex-col bg-secondary">
      <button className="flex h-12 shrink-0 items-center justify-between border-0 border-b border-border bg-transparent px-4 font-bold shadow-sm hover:bg-[var(--bg-hover)]" onClick={headerMenu} aria-haspopup="menu" aria-label={`Menu do servidor ${server.name}`}>
        <span className="truncate">{server.name}</span><ChevronDown size={16} />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
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
