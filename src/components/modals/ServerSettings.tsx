import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Camera, Crown, Hash, Link2, Plus, Shield, Trash2, Users, Volume2, X, Settings, Gavel, ListTree, Lock, Music } from 'lucide-react'
import { rpc, supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { hasPerm, highestRole, type PermContext } from '@/lib/perms'
import { removePublicFile, uploadPublicImage } from '@/lib/media'
import { formatDateTime } from '@/lib/format'
import { qk, useBans, useCategories, useChannels, useMembers, useModLogs, usePermCtx, useRoles } from '@/data/queries'
import { Avatar, ConfirmModal, Modal, Spinner, confirmAction, useAction, useCloseModal } from '@/components/ui'
import { toast, useUI } from '@/store/ui'
import { useSession } from '@/store/session'
import { CategoryModal, ChannelModal, InviteModal } from './ServerModals'
import { memberMenuItems } from './MemberActions'
import { RolesTab } from './RolesTab'
import { MusicSettings } from './MusicSettings'

type Tab = 'overview' | 'roles' | 'channels' | 'members' | 'invites' | 'moderation' | 'music'

interface NavEntry { id: string; label: string; icon: ReactNode }
interface NavGroup { title?: string; items: NavEntry[] }

/** Configurações do servidor em TELA CHEIA: menu à esquerda, conteúdo centralizado, X/ESC no canto. */
function ServerSettingsFrame({ title, groups, tab, setTab, onDelete, wide, children }: { title: string; groups: NavGroup[]; tab: string; setTab: (t: string) => void; onDelete?: () => void; wide?: boolean; children: ReactNode }) {
  const close = useCloseModal()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="modal" aria-label={`Configurações de ${title}`} onClose={close} onCancel={(e) => { e.preventDefault(); close() }}
      style={{ width: '100vw', height: '100dvh', maxWidth: 'none', maxHeight: 'none', borderRadius: 0, border: 0 }}>
      <div className="flex h-full bg-primary text-fg max-md:flex-col">
        <nav className="flex shrink-0 flex-col overflow-y-auto border-b border-border bg-secondary p-3 md:w-72 md:border-r md:border-b-0 md:px-4 md:py-8" aria-label="Seções">
          <div className="mx-auto flex w-full max-w-[250px] flex-col gap-0.5 max-md:max-w-none">
            {groups.map((g, gi) => (
              <div key={g.title ?? gi} className={gi > 0 ? 'mt-3 border-t border-border pt-3' : ''}>
                {g.title && <div className="mb-1 px-2.5 text-xs font-bold text-fg-muted uppercase">{g.title}</div>}
                {g.items.map((t) => (
                  <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id} className={clsx('flex w-full items-center gap-2.5 rounded-md border-0 px-2.5 py-2 text-left font-medium', tab === t.id ? 'bg-[var(--bg-selected)] text-fg' : 'bg-transparent text-fg-2 hover:bg-[var(--bg-hover)]')}>
                    {t.icon}{t.label}
                  </button>
                ))}
              </div>
            ))}
            {onDelete && (
              <div className="mt-3 border-t border-border pt-3">
                <button onClick={onDelete} className="flex w-full items-center justify-between gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-2 text-left font-medium text-[var(--danger-text)] hover:bg-[var(--bg-hover)]">Excluir servidor<Trash2 size={16} /></button>
              </div>
            )}
          </div>
        </nav>
        <section className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-primary px-5 py-8 text-fg md:px-14 md:py-12">
          <div className="fixed top-6 right-8 z-10 flex flex-col items-center gap-1 max-md:top-3 max-md:right-3">
            <button className="grid h-9 w-9 place-items-center rounded-full border-2 border-fg-muted bg-transparent text-fg-2 hover:bg-[var(--bg-hover)] hover:text-fg" onClick={close} aria-label="Fechar configurações"><X size={18} /></button>
            <span className="text-[11px] font-bold text-fg-muted max-md:hidden">ESC</span>
          </div>
          <div className={clsx('mx-auto w-full', wide ? 'max-w-6xl' : 'max-w-3xl')}>{children}</div>
        </section>
      </div>
    </dialog>
  )
}

export function ServerSettingsModal({ serverId, initialTab = 'overview' }: { serverId: string; initialTab?: Tab }) {
  const ctx = usePermCtx(serverId)
  const me = useSession((s) => s.user!.id)
  const nav = useNavigate()
  const qc = useQueryClient()
  const close = useCloseModal()
  const [tab, setTab] = useState<Tab>(initialTab)
  if (!ctx) return <Modal title="Configurações do servidor"><Spinner /></Modal>
  const can = (p: string) => hasPerm(ctx, p)
  const isOwner = ctx.server.owner_id === me
  const entry = (ok: boolean, id: Tab, label: string, icon: ReactNode) => (ok ? [{ id, label, icon }] : [])
  const groups: NavGroup[] = [
    { title: ctx.server.name, items: [...entry(can('manage_server'), 'overview', 'Visão geral', <Settings size={16} />), ...entry(can('manage_channels'), 'channels', 'Canais', <ListTree size={16} />)] },
    { title: 'Pessoas', items: [...entry(true, 'members', 'Membros', <Users size={16} />), ...entry(can('manage_roles'), 'roles', 'Cargos', <Shield size={16} />), ...entry(can('create_invite') || can('manage_server'), 'invites', 'Convites', <Link2 size={16} />)] },
    { title: 'Integrações', items: entry(can('manage_server'), 'music', 'Música', <Music size={16} />) },
    { title: 'Moderação', items: entry(can('ban_members') || can('manage_server'), 'moderation', 'Banimentos e registro', <Gavel size={16} />) },
  ].filter((g) => g.items.length)
  const all = groups.flatMap((g) => g.items)
  const active = all.some((t) => t.id === tab) ? tab : (all[0].id as Tab)
  const del = () => confirmAction({
    title: 'Excluir servidor',
    message: <>Esta ação é <strong>permanente</strong>. Todas as mensagens e canais de <strong>{ctx.server.name}</strong> serão apagados. Digite o nome do servidor para confirmar.</>,
    confirmLabel: 'Excluir servidor', danger: true, requireText: ctx.server.name,
    onConfirm: async () => {
      await rpc('delete_server', { p_server: ctx.server.id })
      if (ctx.server.icon_path) void removePublicFile(ctx.server.icon_path)
      await qc.invalidateQueries({ queryKey: qk.servers })
      close()
      nav('/app/@me')
    },
  })
  return (
    <ServerSettingsFrame title={ctx.server.name} groups={groups} tab={active} setTab={(t) => setTab(t as Tab)} onDelete={isOwner ? del : undefined} wide={active === 'roles'}>
      {active === 'overview' && <Overview ctx={ctx} />}
      {active === 'roles' && <RolesTab ctx={ctx} />}
      {active === 'channels' && <ChannelsTab ctx={ctx} />}
      {active === 'members' && <MembersTab ctx={ctx} />}
      {active === 'invites' && <InvitesTab ctx={ctx} />}
      {active === 'moderation' && <ModerationTab ctx={ctx} />}
      {active === 'music' && <MusicSettings ctx={ctx} />}
    </ServerSettingsFrame>
  )
}
const H = ({ children }: { children: ReactNode }) => <h2 className="mt-0 mb-5 text-xl font-bold">{children}</h2>

/* ------------------------------------------------------------ visão geral */
function Overview({ ctx }: { ctx: PermContext }) {
  const qc = useQueryClient()
  const { server } = ctx
  const [name, setName] = useState(server.name)
  const [icon, setIcon] = useState(server.icon_path)
  const [clear, setClear] = useState(false)
  const { busy, run } = useAction()
  const file = useRef<HTMLInputElement>(null)
  const dirty = name.trim() !== server.name || icon !== server.icon_path

  const pick = (f: File | undefined) => {
    if (!f) return
    run(async () => {
      const path = await uploadPublicImage('servers', server.id, f)
      setIcon(path)
      setClear(false)
    })
  }

  const save = () =>
    run(async () => {
      await rpc('update_server', { p_server: server.id, p_name: name, p_icon_path: icon && icon !== server.icon_path ? icon : null, p_clear_icon: clear })
      if (clear && server.icon_path) void removePublicFile(server.icon_path)
      await qc.invalidateQueries({ queryKey: qk.servers })
      toast.success('Servidor atualizado.')
    })

  return (
    <div className="max-w-xl">
      <H>Visão geral</H>
      <div className="flex flex-wrap items-center gap-5">
        <button type="button" onClick={() => file.current?.click()} className="group relative rounded-2xl" aria-label="Alterar ícone do servidor">
          <Avatar path={clear ? null : icon} name={name} id={server.id} size={96} square />
          <span className="absolute inset-0 grid place-items-center rounded-2xl bg-black/50 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"><Camera /></span>
        </button>
        <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
        <div className="flex flex-col gap-2">
          <button className="btn" onClick={() => file.current?.click()}>Enviar imagem</button>
          {(icon || server.icon_path) && !clear && <button className="btn btn-ghost" onClick={() => { setClear(true); setIcon(null) }}>Remover imagem</button>}
          <span className="hint">PNG, JPEG, WebP ou GIF até 5 MB.</span>
        </div>
      </div>
      <div className="field mt-5"><label htmlFor="s-name">Nome do servidor</label><input id="s-name" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></div>
      <button className="btn btn-primary mt-4" disabled={busy || !dirty || !name.trim()} onClick={() => void save()}>{busy && <Spinner size={14} />} Salvar alterações</button>

    </div>
  )
}

/* ----------------------------------------------------------------- canais */
function ChannelsTab({ ctx }: { ctx: PermContext }) {
  const sid = ctx.server.id
  const qc = useQueryClient()
  const { data: channels } = useChannels(sid)
  const { data: categories } = useCategories(sid)
  const open = useUI((s) => s.openModal)
  const grouped = useMemo(() => {
    const cats = (categories ?? []).map((c) => ({ id: c.id as string | null, name: c.name, chans: (channels ?? []).filter((x) => x.category_id === c.id) }))
    const orphans = (channels ?? []).filter((x) => !x.category_id)
    return orphans.length ? [{ id: null, name: 'Sem categoria', chans: orphans }, ...cats] : cats
  }, [channels, categories])

  return (
    <div>
      <H>Canais</H>
      <div className="mb-4 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => open(<ChannelModal serverId={sid} />)}><Plus size={14} /> Criar canal</button>
        <button className="btn" onClick={() => open(<CategoryModal serverId={sid} />)}><Plus size={14} /> Criar categoria</button>
      </div>
      <p className="hint mb-4">Para reordenar, arraste canais e categorias na barra lateral.</p>
      {grouped.map((g) => (
        <div key={g.id ?? 'none'} className="mb-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="label">{g.name}</span>
            {g.id && (
              <span className="flex gap-1">
                <button className="btn btn-sm btn-ghost" onClick={() => open(<CategoryModal serverId={sid} category={{ id: g.id!, name: g.name }} />)}>Renomear</button>
                <button className="btn btn-sm btn-ghost text-danger" onClick={() => confirmAction({ title: `Excluir categoria “${g.name}”`, message: 'Os canais dentro dela ficarão sem categoria.', confirmLabel: 'Excluir', danger: true, onConfirm: async () => { await rpc('delete_category', { p_category: g.id }); await qc.invalidateQueries({ queryKey: qk.categories(sid) }); await qc.invalidateQueries({ queryKey: qk.channels(sid) }) } })}>Excluir</button>
              </span>
            )}
          </div>
          {g.chans.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-md bg-secondary p-2 pl-3 not-last:mb-1">
              {c.kind === 'text' ? <Hash size={16} className="text-fg-muted" /> : <Volume2 size={16} className="text-fg-muted" />}
              <span className="flex-1 truncate">{c.name}</span>
              {c.is_private && <Lock size={13} className="text-fg-muted" aria-label="Privado" />}
              <button className="btn btn-sm" onClick={() => open(<ChannelPermissionsModal serverId={sid} channelId={c.id} />)}>Permissões</button>
              <button className="btn btn-sm" onClick={() => open(<ChannelModal serverId={sid} channel={c} />)}>Editar</button>
              <button className="icon-btn danger" aria-label={`Excluir ${c.name}`} onClick={() => confirmAction({ title: `Excluir #${c.name}`, message: 'Todas as mensagens deste canal serão apagadas permanentemente.', confirmLabel: 'Excluir canal', danger: true, onConfirm: async () => { await rpc('delete_channel', { p_channel: c.id }); await qc.invalidateQueries({ queryKey: qk.channels(sid) }) } })}><Trash2 size={16} /></button>
            </div>
          ))}
          {!g.chans.length && <div className="pl-3 text-xs text-fg-muted">Nenhum canal.</div>}
        </div>
      ))}
    </div>
  )
}

type Tri = boolean | null
function ChannelPermissionsModal({ serverId, channelId }: { serverId: string; channelId: string }) {
  const close = useCloseModal()
  const { data: channels } = useChannels(serverId)
  const { data: roles } = useRoles(serverId)
  const { data: members } = useMembers(serverId)
  const [rows, setRows] = useState<{ id: string; role_id: string | null; user_id: string | null; can_view: Tri; can_send: Tri }[] | null>(null)
  const [adding, setAdding] = useState('')
  const channel = channels?.find((c) => c.id === channelId)

  const load = async () => {
    const { data } = await supabase.from('channel_overwrites').select('*').eq('channel_id', channelId)
    setRows((data ?? []) as never)
  }
  useEffect(() => { void load() }, [channelId]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = async (target: { role?: string; user?: string }, view: Tri, send: Tri) => {
    try {
      await rpc('set_channel_overwrite', { p_channel: channelId, p_role: target.role ?? null, p_user: target.user ?? null, p_can_view: view, p_can_send: send })
      await load()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const label = (r: { role_id: string | null; user_id: string | null }) =>
    r.role_id ? roles?.find((x) => x.id === r.role_id)?.name ?? 'Cargo' : members?.find((m) => m.user_id === r.user_id)?.profile?.display_name ?? 'Membro'
  const cycle = (v: Tri): Tri => (v === null ? true : v === true ? false : null)
  const sym = (v: Tri) => (v === null ? '/' : v ? '✓' : '✕')
  const addOptions = [
    ...(roles ?? []).filter((r) => !rows?.some((x) => x.role_id === r.id)).map((r) => ({ v: `r:${r.id}`, l: `Cargo: ${r.is_default ? 'Todos os membros' : r.name}` })),
    ...(members ?? []).filter((m) => !rows?.some((x) => x.user_id === m.user_id)).map((m) => ({ v: `u:${m.user_id}`, l: `Membro: ${m.profile?.display_name || m.profile?.username}` })),
  ]

  return (
    <Modal title={`Permissões de ${channel?.kind === 'voice' ? '' : '#'}${channel?.name ?? ''}`} description={channel?.is_private ? 'Canal privado: só quem tiver “ver” permitido (ou administradores) o enxerga.' : 'Canal público: use ✕ para restringir.'} footer={<button className="btn btn-primary" onClick={close}>Concluir</button>}>
      <p className="hint mb-3">Clique para alternar: <strong>✓</strong> permitir • <strong>✕</strong> negar • <strong>/</strong> herdar. Entre cargos, “permitir” vence; regra por membro vence regra por cargo.</p>
      {!rows ? <Spinner /> : (
        <table className="w-full border-collapse text-left">
          <thead><tr className="text-xs text-fg-muted uppercase"><th className="pb-1">Alvo</th><th className="pb-1 text-center">Ver</th><th className="pb-1 text-center">{channel?.kind === 'voice' ? 'Conectar' : 'Enviar'}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1.5">{label(r)}</td>
                <td className="text-center"><button className="btn btn-sm w-10" onClick={() => void set(r.role_id ? { role: r.role_id } : { user: r.user_id! }, cycle(r.can_view), r.can_send)}>{sym(r.can_view)}</button></td>
                <td className="text-center"><button className="btn btn-sm w-10" onClick={() => void set(r.role_id ? { role: r.role_id } : { user: r.user_id! }, r.can_view, cycle(r.can_send))}>{sym(r.can_send)}</button></td>
                <td className="text-right"><button className="icon-btn" aria-label="Remover regra" onClick={() => void set(r.role_id ? { role: r.role_id } : { user: r.user_id! }, null, null)}><X size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex gap-2">
        <select className="select" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Adicionar alvo"><option value="">Adicionar cargo ou membro…</option>{addOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
        <button className="btn" disabled={!adding} onClick={() => { const [k, id] = adding.split(':'); void set(k === 'r' ? { role: id } : { user: id }, true, null).then(() => setAdding('')) }}>Adicionar</button>
      </div>
    </Modal>
  )
}

/* ---------------------------------------------------------------- membros */
function MembersTab({ ctx }: { ctx: PermContext }) {
  const qc = useQueryClient()
  const nav = useNavigate()
  const me = useSession((s) => s.user!.id)
  const { data: members, isLoading } = useMembers(ctx.server.id)
  const { data: roles } = useRoles(ctx.server.id)
  const openMenu = useUI((s) => s.openMenu)
  const [q, setQ] = useState('')
  const list = (members ?? []).filter((m) => `${m.profile?.display_name} ${m.profile?.username} ${m.nickname ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <H>Membros — {members?.length ?? 0}</H>
      <input className="input mb-3" placeholder="Buscar membro…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar membro" />
      {isLoading ? <Spinner /> : list.map((m) => {
        const top = roles && highestRole(roles, m)
        const items = () => memberMenuItems({ ctx, member: m, roles: roles ?? [], me, nav, qc })
        return (
          <div key={m.user_id} className="flex items-center gap-3 border-b border-border py-2">
            <Avatar path={m.profile?.avatar_path} name={m.profile?.display_name ?? '?'} id={m.user_id} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 truncate font-semibold">{m.profile?.display_name || m.profile?.username}{ctx.server.owner_id === m.user_id && <Crown size={13} className="text-warning" aria-label="Dono" />}</div>
              <div className="text-xs text-fg-muted">@{m.profile?.username} • desde {formatDateTime(m.joined_at)}</div>
            </div>
            {top && <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: `${top.color}33`, color: top.color }}>{top.name}</span>}
            <button className="btn btn-sm" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left - 120, r.bottom + 4, items()) }} disabled={!items().length}>Ações</button>
          </div>
        )
      })}
    </div>
  )
}

function InvitesTab({ ctx }: { ctx: PermContext }) {
  const open = useUI((s) => s.openModal)
  return (
    <div>
      <H>Convites</H>
      <p className="text-fg-2">Gere links com expiração e limite de usos, ou revogue os existentes.</p>
      <button className="btn btn-primary" onClick={() => open(<InviteModal serverId={ctx.server.id} serverName={ctx.server.name} />)}><Link2 size={14} /> Gerenciar convites</button>
    </div>
  )
}

const ACTION_LABEL: Record<string, string> = {
  server_created: 'Servidor criado', server_updated: 'Servidor editado', ownership_transferred: 'Propriedade transferida',
  role_created: 'Cargo criado', role_updated: 'Cargo editado', role_deleted: 'Cargo excluído', role_granted: 'Cargo atribuído',
  role_revoked: 'Cargo removido', kick: 'Expulsão', ban: 'Banimento', unban: 'Banimento revertido', message_deleted: 'Mensagem apagada por moderação', timeout: 'Castigo', timeout_removed: 'Castigo removido', voice_mute: 'Silenciado na voz', voice_unmute: 'Silêncio removido', voice_deafen: 'Áudio desativado', voice_undeafen: 'Áudio restaurado', voice_disconnect: 'Desconectado da voz', voice_move: 'Movido de canal de voz', music_bot_on: 'Bot de música ligado', music_bot_off: 'Bot de música desligado', roles_reordered: 'Cargos reordenados',
}

function ModerationTab({ ctx }: { ctx: PermContext }) {
  const sid = ctx.server.id
  const qc = useQueryClient()
  const { data: bans, isLoading } = useBans(sid)
  const { data: logs, isLoading: loadingLogs } = useModLogs(sid)
  const { data: members } = useMembers(sid)
  const nameOf = (id: string | null) => (id ? members?.find((m) => m.user_id === id)?.profile?.display_name ?? 'Ex-membro' : '—')
  return (
    <div>
      <H>Moderação</H>
      <h3 className="mt-0">Banidos</h3>
      {isLoading ? <Spinner /> : !bans?.length ? <p className="text-fg-muted">Ninguém está banido.</p> : bans.map((b) => (
        <div key={b.user_id} className="flex items-center gap-3 border-b border-border py-2">
          <Avatar path={b.profile?.avatar_path} name={b.profile?.display_name ?? '?'} id={b.user_id} size={32} />
          <div className="min-w-0 flex-1"><div className="font-semibold">{b.profile?.display_name || b.profile?.username || b.user_id.slice(0, 8)}</div><div className="truncate text-xs text-fg-muted">{b.reason || 'Sem motivo'} • {formatDateTime(b.created_at)}</div></div>
          <button className="btn btn-sm" onClick={() => rpc('unban_member', { p_server: sid, p_user: b.user_id }).then(() => qc.invalidateQueries({ queryKey: qk.bans(sid) }), (e) => toast.error(errorMessage(e)))}>Desbanir</button>
        </div>
      ))}
      <h3 className="mt-8">Registro de moderação</h3>
      {loadingLogs ? <Spinner /> : !logs?.length ? <p className="text-fg-muted">Nada registrado ainda.</p> : (
        <ul className="m-0 list-none p-0 text-sm">
          {logs.map((l) => <li key={l.id} className="border-b border-border py-1.5"><strong>{ACTION_LABEL[l.action] ?? l.action}</strong> — por {nameOf(l.actor_id)}{l.target_id ? ` em ${nameOf(l.target_id)}` : ''} <span className="text-xs text-fg-muted">• {formatDateTime(l.created_at)}</span>{typeof l.details?.reason === 'string' && l.details.reason ? <span className="text-fg-2"> — “{l.details.reason}”</span> : null}</li>)}
        </ul>
      )}
    </div>
  )
}

export function ConfirmLeaveServer({ serverId, name }: { serverId: string; name: string }) {
  const qc = useQueryClient()
  const nav = useNavigate()
  return (
    <ConfirmModal title={`Sair de ${name}`} message="Você precisará de um novo convite para voltar." confirmLabel="Sair do servidor" danger
      onConfirm={async () => { await rpc('leave_server', { p_server: serverId }); await qc.invalidateQueries({ queryKey: qk.servers }); nav('/app/@me') }} />
  )
}
