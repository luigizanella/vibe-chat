import { useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, Ban, Check, MessageSquare, MoreVertical, Plus, Search, UserMinus, UserPlus, Users, X, BellOff, LogOut } from 'lucide-react'
import { rpc, supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { qk, useBlocks, useDMs, useFriends, useNotifPrefs, useUnread, type FriendEntry } from '@/data/queries'
import { presenceOfUser, usePresenceOf, usePresenceStore } from '@/data/presence'
import { findPref, setNotifPref } from '@/data/actions'
import { useSession } from '@/store/session'
import { toast, useUI } from '@/store/ui'
import { Avatar, CenterSpinner, EmptyState, IconButton, Modal, Spinner, confirmAction, useAction, useCloseModal } from '@/components/ui'
import { ChatView } from '@/components/chat/ChatView'
import { useDmChatCtx } from '@/components/chat/useChatCtx'
import type { DmConversation, MiniProfile, Presence } from '@/lib/types'
import { UserPanel, VoiceDock } from '@/components/shell/UserPanel'

export function dmTitle(dm: DmConversation, me: string): { name: string; people: MiniProfile[]; otherId?: string } {
  const others = dm.dm_participants.filter((p) => p.user_id !== me)
  const people = others.map((p) => p.profile).filter(Boolean) as MiniProfile[]
  if (dm.is_group) return { name: dm.name || people.map((p) => p.display_name || p.username).join(', ') || 'Grupo', people }
  const p = people[0]
  return { name: p ? p.display_name || p.username : 'Usuário', people, otherId: others[0]?.user_id }
}

function DmAvatar({ dm, me, size = 32 }: { dm: DmConversation; me: string; size?: number }) {
  const t = dmTitle(dm, me)
  const status = usePresenceOf(t.otherId)
  if (dm.is_group) return <span className="grid shrink-0 place-items-center rounded-full bg-accent text-[var(--accent-contrast)]" style={{ width: size, height: size }}><Users size={size * 0.5} /></span>
  return <Avatar path={t.people[0]?.avatar_path} name={t.name} id={t.otherId ?? dm.id} size={size} status={status} ring="var(--bg-secondary)" />
}

export function HomeSidebar() {
  const { dmId } = useParams()
  const me = useSession((s) => s.user!.id)
  const { data: dms, isLoading } = useDMs()
  const { data: unread } = useUnread()
  const { data: prefs } = useNotifPrefs()
  const { data: friends } = useFriends()
  const qc = useQueryClient()
  const nav = useNavigate()
  const openModal = useUI((s) => s.openModal)
  const openMenu = useUI((s) => s.openMenu)
  const setMobilePane = useUI((s) => s.setMobilePane)
  const setQuick = useUI((s) => s.setQuickSwitcher)
  const pending = friends?.filter((f) => f.status === 'incoming').length ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-secondary">
      <div className="border-b border-border p-2.5 shadow-sm">
        <button className="flex h-7 w-full items-center overflow-hidden rounded border-0 bg-[var(--bg-input)] px-2 text-left text-xs whitespace-nowrap text-fg-muted" onClick={() => setQuick(true)} aria-label="Encontrar ou iniciar uma conversa"><Search size={13} className="mr-1.5" /> Encontrar ou iniciar uma conversa</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <NavLink to="/app/@me" end onClick={() => setMobilePane('main')} className={({ isActive }) => clsx('mb-1 flex items-center gap-3 rounded-md px-2.5 py-2 font-semibold no-underline', isActive ? 'bg-[var(--bg-selected)] text-fg' : 'text-fg-2 hover:bg-[var(--bg-hover)]')}>
          <Users size={20} /> Amigos {pending > 0 && <span className="badge ml-auto">{pending}</span>}
        </NavLink>
        <div className="flex items-center justify-between px-2 pt-4 pb-1 text-xs font-bold tracking-wide text-fg-muted uppercase">
          Mensagens diretas
          <button className="icon-btn h-5 w-5" aria-label="Criar grupo de mensagens" data-tip="Criar grupo" onClick={() => openModal(<GroupDmModal />)}><Plus size={14} /></button>
        </div>
        {isLoading ? <Spinner className="m-3" /> : !dms?.length ? <p className="px-2 text-xs text-fg-muted">Nenhuma conversa ainda. Abra o perfil de um amigo e clique em “Mensagem”.</p> : dms.map((dm) => {
          const t = dmTitle(dm, me)
          const u = unread?.find((x) => x.dm_id === dm.id)
          const muted = findPref(prefs, { dm_id: dm.id })?.muted
          return (
            <NavLink key={dm.id} to={`/app/@me/${dm.id}`} onClick={() => setMobilePane('main')} aria-current={dm.id === dmId ? 'page' : undefined}
              onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, [
                { label: muted ? 'Reativar notificações' : 'Silenciar conversa', icon: <BellOff size={14} />, onClick: () => void setNotifPref(qc, { dm_id: dm.id }, { muted: !muted }) },
                { label: dm.is_group ? 'Sair do grupo' : 'Fechar conversa', icon: <LogOut size={14} />, danger: true, onClick: () => confirmAction({ title: dm.is_group ? 'Sair do grupo' : 'Fechar conversa', message: dm.is_group ? 'Você deixará de receber mensagens deste grupo.' : 'A conversa some da sua lista; o histórico é mantido e ela reaparece se vocês voltarem a conversar.', confirmLabel: 'Confirmar', danger: true, onConfirm: async () => { await rpc('leave_dm', { p_dm: dm.id }); await qc.invalidateQueries({ queryKey: qk.dms }); if (dm.id === dmId) nav('/app/@me') } }) },
              ]) }}
              className={clsx('mb-0.5 flex items-center gap-3 rounded-md px-2 py-1.5 no-underline', dm.id === dmId ? 'bg-[var(--bg-selected)] text-fg' : 'text-fg-2 hover:bg-[var(--bg-hover)]', u && !muted && 'font-bold text-fg')}>
              <DmAvatar dm={dm} me={me} />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {muted ? <BellOff size={12} /> : u && <span className="badge">{u.mention_count || u.unread_count}</span>}
            </NavLink>
          )
        })}
      </div>
      <VoiceDock />
      <UserPanel />
    </div>
  )
}

/* ------------------------------------------------------------- grupo DM */
function GroupDmModal() {
  const close = useCloseModal()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: friends } = useFriends()
  const [sel, setSel] = useState<string[]>([])
  const [name, setName] = useState('')
  const { busy, run } = useAction()
  const list = friends?.filter((f) => f.status === 'friend') ?? []
  return (
    <Modal title="Criar grupo de mensagens" description="Escolha de 2 a 9 amigos." footer={<><button className="btn btn-ghost" onClick={close}>Cancelar</button><button className="btn btn-primary" disabled={busy || sel.length < 2} onClick={() => void run(async () => { const id = await rpc<string>('create_group_dm', { p_users: sel, p_name: name || null }); await qc.invalidateQueries({ queryKey: qk.dms }); close(); nav(`/app/@me/${id}`) })}>Criar grupo</button></>}>
      <div className="field mb-3"><label htmlFor="gname">Nome do grupo (opcional)</label><input id="gname" className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></div>
      {!list.length ? <p className="text-fg-muted">Você precisa ter pelo menos 2 amigos para criar um grupo.</p> : list.map((f) => (
        <label key={f.other.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-[var(--bg-hover)]">
          <input type="checkbox" checked={sel.includes(f.other.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, f.other.id].slice(0, 9) : s.filter((x) => x !== f.other.id)))} />
          <Avatar path={f.other.avatar_path} name={f.other.display_name} id={f.other.id} size={28} /><span className="font-semibold">{f.other.display_name}</span><span className="text-xs text-fg-muted">@{f.other.username}</span>
        </label>
      ))}
    </Modal>
  )
}

/* ---------------------------------------------------------------- Amigos */
type FTab = 'online' | 'all' | 'pending' | 'blocked' | 'add'

function FriendRow({ f }: { f: FriendEntry }) {
  const status: Presence = usePresenceOf(f.other.id)
  const nav = useNavigate()
  const qc = useQueryClient()
  const openProfile = useUI((s) => s.openProfile)
  const openMenu = useUI((s) => s.openMenu)
  const refresh = () => qc.invalidateQueries({ queryKey: qk.friends })
  const dm = () => rpc<string>('open_dm', { p_user: f.other.id }).then((id) => { void qc.invalidateQueries({ queryKey: qk.dms }); nav(`/app/@me/${id}`) }, (e) => toast.error(errorMessage(e)))
  const act = (fn: () => PromiseLike<unknown>) => fn().then(() => refresh(), (e) => toast.error(errorMessage(e)))
  return (
    <div className="group flex items-center gap-3 rounded-lg border-t border-border px-3 py-2.5 hover:bg-[var(--bg-hover)]">
      <button className="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent p-0 text-left" onClick={(e) => openProfile(f.other.id, null, e.clientX, e.clientY)}>
        <Avatar path={f.other.avatar_path} name={f.other.display_name} id={f.other.id} size={36} status={f.status === 'friend' ? status : undefined} ring="var(--bg-primary)" />
        <span className="min-w-0"><span className="block truncate font-semibold">{f.other.display_name || f.other.username}</span>
          <span className="block truncate text-xs text-fg-muted">{f.status === 'incoming' ? 'Pedido recebido' : f.status === 'outgoing' ? 'Pedido enviado' : f.other.custom_status || (status === 'offline' ? 'Offline' : status === 'dnd' ? 'Não perturbe' : status === 'idle' ? 'Ausente' : 'Online')}</span></span>
      </button>
      {f.status === 'friend' && <IconButton label="Enviar mensagem" onClick={() => void dm()}><MessageSquare size={18} /></IconButton>}
      {f.status === 'incoming' && <>
        <IconButton label="Aceitar" className="text-success" onClick={() => void act(() => rpc('respond_friend_request', { p_requester: f.other.id, p_accept: true }))}><Check size={20} /></IconButton>
        <IconButton label="Recusar" className="danger" onClick={() => void act(() => rpc('respond_friend_request', { p_requester: f.other.id, p_accept: false }))}><X size={20} /></IconButton></>}
      {f.status === 'outgoing' && <IconButton label="Cancelar pedido" className="danger" onClick={() => void act(() => rpc('remove_friend', { p_user: f.other.id }))}><X size={20} /></IconButton>}
      {f.status === 'friend' && <IconButton label="Mais" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left - 150, r.bottom, [
        { label: 'Remover amigo', icon: <UserMinus size={14} />, danger: true, onClick: () => confirmAction({ title: `Remover ${f.other.display_name}`, message: 'Vocês deixarão de ser amigos.', confirmLabel: 'Remover', danger: true, onConfirm: async () => { await rpc('remove_friend', { p_user: f.other.id }); await refresh() } }) },
        { label: 'Bloquear', icon: <Ban size={14} />, danger: true, onClick: () => confirmAction({ title: `Bloquear ${f.other.display_name}`, message: 'A amizade será desfeita e vocês não poderão trocar mensagens diretas.', confirmLabel: 'Bloquear', danger: true, onConfirm: async () => { await rpc('block_user', { p_user: f.other.id }); await refresh(); await qc.invalidateQueries({ queryKey: qk.blocks }) } }) },
      ]) }}><MoreVertical size={18} /></IconButton>}
    </div>
  )
}

function AddFriend() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [results, setResults] = useState<MiniProfile[]>([])
  const { busy, run } = useAction()

  useEffect(() => {
    const q = name.trim().replace(/^@/, '')
    if (q.length < 2) return setResults([])
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('search_users', { p_query: q, p_limit: 6 })
      setResults((data ?? []) as MiniProfile[])
    }, 300)
    return () => clearTimeout(t)
  }, [name])

  const send = (username: string) =>
    run(async () => {
      try {
        const r = await rpc<string>('send_friend_request', { p_username: username })
        setMsg({ ok: true, text: r === 'accepted' ? `Você e ${username} agora são amigos!` : r === 'already_friends' ? `Vocês já são amigos.` : r === 'already_pending' ? 'Já existe um pedido pendente.' : `Pedido de amizade enviado para ${username}.` })
        setName('')
        await qc.invalidateQueries({ queryKey: qk.friends })
      } catch (e) {
        setMsg({ ok: false, text: errorMessage(e) === 'Item não encontrado (pode ter sido removido).' ? 'Nenhum usuário com esse nome de usuário.' : errorMessage(e) })
      }
    })

  return (
    <div className="max-w-2xl p-6">
      <h2 className="mt-0">Adicionar amigo</h2>
      <p className="text-fg-2">Digite o nome de usuário exato (ou busque por prefixo abaixo).</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(name.trim().replace(/^@/, '').toLowerCase()) }}>
        <input className="input" placeholder="nome_de_usuario" value={name} onChange={(e) => { setName(e.target.value); setMsg(null) }} aria-label="Nome de usuário" autoFocus />
        <button className="btn btn-primary" disabled={busy || name.trim().length < 2}>{busy ? <Spinner size={14} /> : <UserPlus size={15} />} Enviar pedido</button>
      </form>
      {msg && <p className={msg.ok ? 'text-success' : 'error-text'} role="status">{msg.text}</p>}
      {results.length > 0 && (
        <ul className="m-0 mt-4 list-none p-0">
          {results.map((p) => (
            <li key={p.id} className="flex items-center gap-3 border-t border-border py-2">
              <Avatar path={p.avatar_path} name={p.display_name} id={p.id} size={32} /><div className="flex-1"><div className="font-semibold">{p.display_name}</div><div className="text-xs text-fg-muted">@{p.username}</div></div>
              <button className="btn btn-sm" disabled={busy} onClick={() => void send(p.username)}>Adicionar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function FriendsPage() {
  const { data: friends, isLoading } = useFriends()
  const { data: blocked } = useBlocks()
  const qc = useQueryClient()
  const setMobilePane = useUI((s) => s.setMobilePane)
  const [tab, setTab] = useState<FTab>('online')
  const [q, setQ] = useState('')
  const accepted = useMemo(() => friends?.filter((f) => f.status === 'friend') ?? [], [friends])
  const pending = friends?.filter((f) => f.status !== 'friend') ?? []
  const tabs: [FTab, string][] = [['online', 'Online'], ['all', 'Todos'], ['pending', `Pendentes${pending.length ? ` (${pending.length})` : ''}`], ['blocked', 'Bloqueados'], ['add', 'Adicionar amigo']]
  const filter = (list: FriendEntry[]) => list.filter((f) => `${f.other.display_name} ${f.other.username}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="flex h-full min-w-0 flex-col bg-primary">
      <header className="flex h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-border px-3 shadow-sm">
        <IconButton label="Voltar" className="md:hidden" onClick={() => setMobilePane('nav')}><ArrowLeft size={20} /></IconButton>
        <Users size={20} className="shrink-0 text-fg-muted" /><h1 className="m-0 shrink-0 text-base font-bold">Amigos</h1>
        <nav className="ml-2 flex gap-1" aria-label="Seções de amigos">
          {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} aria-current={tab === k} className={clsx('btn btn-sm shrink-0', k === 'add' ? (tab === k ? 'btn-primary' : 'bg-[var(--success)] text-white') : tab === k ? '' : 'btn-ghost')}>{l}</button>)}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'add' ? <AddFriend /> : tab === 'blocked' ? (
          <div className="p-4">{!blocked?.length ? <EmptyState icon={<Ban />} title="Ninguém bloqueado" /> : blocked.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-t border-border px-3 py-2.5"><Avatar path={p.avatar_path} name={p.display_name} id={p.id} size={36} /><div className="flex-1 font-semibold">{p.display_name}</div>
              <button className="btn btn-sm" onClick={() => rpc('unblock_user', { p_user: p.id }).then(() => qc.invalidateQueries({ queryKey: qk.blocks }), (e) => toast.error(errorMessage(e)))}>Desbloquear</button></div>
          ))}</div>
        ) : isLoading ? <CenterSpinner /> : (
          <div className="p-4">
            <div className="relative mb-4"><Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" /><input className="input pl-9" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar amigos" /></div>
            {tab === 'pending' ? (!pending.length ? <EmptyState icon={<UserPlus />} title="Sem pedidos pendentes" /> : filter(pending).map((f) => <FriendRow key={f.other.id} f={f} />))
              : tab === 'all' ? (!accepted.length ? <EmptyState icon={<Users />} title="Nenhum amigo ainda">Use “Adicionar amigo” para enviar um pedido pelo nome de usuário.</EmptyState> : <><div className="label mb-2">Todos os amigos — {accepted.length}</div>{filter(accepted).map((f) => <FriendRow key={f.other.id} f={f} />)}</>)
              : <OnlineFriends list={filter(accepted)} />}
          </div>
        )}
      </div>
    </div>
  )
}

function OnlineFriends({ list }: { list: FriendEntry[] }) {
  const byTopic = usePresenceStore((s) => s.byTopic)
  const online = list.filter((f) => presenceOfUser(byTopic, f.other.id) !== 'offline')
  if (!online.length) return <EmptyState icon={<Users />} title="Ninguém online agora">Quando seus amigos estiverem conectados, eles aparecem aqui.</EmptyState>
  return (
    <>
      <div className="label mb-2">Online — {online.length}</div>
      {online.map((f) => <FriendRow key={f.other.id} f={f} />)}
    </>
  )
}
/* -------------------------------------------------------------------- DM */
export function DmPage() {
  const { dmId = '' } = useParams()
  const me = useSession((s) => s.user!.id)
  const { data: dms, isLoading } = useDMs()
  const setActive = useUI((s) => s.setActive)
  const setMobilePane = useUI((s) => s.setMobilePane)
  const dm = dms?.find((d) => d.id === dmId)
  const ctx = useDmChatCtx(dm, dmId)
  const [panel, setPanel] = useState<'pins' | 'search' | null>(null)
  useEffect(() => {
    setActive({ dmId })
    return () => setActive({ dmId: null })
  }, [dmId, setActive])
  useEffect(() => setPanel(null), [dmId])

  if (isLoading) return <CenterSpinner />
  if (!dm) return <Navigate to="/app/@me" replace />
  const t = dmTitle(dm, me)
  return (
    <ChatView
      ctx={ctx}
      panel={panel}
      onPanelChange={setPanel}
      placeholder={`Conversar com ${dm.is_group ? t.name : '@' + (t.people[0]?.username ?? 'usuário')}`}
      header={(tools) => (
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3 shadow-sm">
          <IconButton label="Voltar" className="md:hidden" onClick={() => setMobilePane('nav')}><ArrowLeft size={20} /></IconButton>
          <DmAvatar dm={dm} me={me} size={28} /><h1 className="m-0 min-w-0 flex-1 truncate text-base font-bold">{t.name}</h1>
          {tools.pins()}{tools.search()}
        </header>
      )}
    />
  )
}
