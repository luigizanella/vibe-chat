import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import clsx from 'clsx'
import { GripVertical, Lock, Plus, Search, Shield, Trash2, Users } from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { hasPerm, PERMISSIONS, topPosition, type PermContext } from '@/lib/perms'
import { useReadable } from '@/lib/useReadable'
import { qk, useMembers, useRoles } from '@/data/queries'
import { Avatar, EmptyState, Modal, Spinner, Toggle, confirmAction, useAction, useCloseModal } from '@/components/ui'
import { toast, useUI } from '@/store/ui'
import { useSession } from '@/store/session'
import type { Member, Role } from '@/lib/types'

const H = ({ children }: { children: React.ReactNode }) => <h2 className="mt-0 mb-5 text-xl font-bold">{children}</h2>

/** Espelho (só para a UI) da regra do banco: quem pode conceder/retirar o cargo a quem. */
function canAssign(ctx: PermContext, me: string, target: Member, role: Role, grant: boolean): boolean {
  if (role.is_default) return false
  if (ctx.server.owner_id === me) return true
  if (!hasPerm(ctx, 'manage_roles') || role.position >= topPosition(ctx)) return false
  if (target.user_id === me) return !grant || role.permissions.every((p) => hasPerm(ctx, p))
  if (ctx.server.owner_id === target.user_id) return false
  const roles = ctx.roles
  const mine = new Set(target.member_roles.map((r) => r.role_id))
  const theirTop = Math.max(0, ...roles.filter((r) => r.is_default || mine.has(r.id)).map((r) => r.position))
  return topPosition(ctx) > theirTop
}

/* ------------------------------------------------------------------ lista */
function RoleRow({ role, selected, locked, count, onSelect }: { role: Role; selected: boolean; locked: boolean; count: number; onSelect: () => void }) {
  const readable = useReadable('secondary')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: role.id, disabled: locked || role.is_default })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}>
      <div className={clsx('flex items-center rounded-md', selected ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]')}>
        {role.is_default ? (
          <span className="w-6" />
        ) : (
          <span
            {...attributes}
            {...listeners}
            role="button"
            tabIndex={locked ? -1 : 0}
            aria-label={locked ? `${role.name}: acima do seu nível, não pode ser movido` : `Arrastar para reordenar ${role.name}`}
            aria-disabled={locked}
            className={clsx('grid h-8 w-6 place-items-center text-fg-muted', locked ? 'cursor-not-allowed opacity-50' : 'cursor-grab')}
          >
            {locked ? <Lock size={12} /> : <GripVertical size={14} />}
          </span>
        )}
        <button className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent py-1.5 pr-2 text-left" onClick={onSelect}>
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: role.color }} />
          <span className="min-w-0 flex-1 truncate font-medium" style={{ color: readable(role.color) }}>{role.is_default ? 'Todos os membros' : role.name}</span>
          <span className="flex items-center gap-1 text-xs text-fg-muted"><Users size={12} />{count}</span>
        </button>
      </div>
    </li>
  )
}

export function RolesTab({ ctx }: { ctx: PermContext }) {
  const qc = useQueryClient()
  const sid = ctx.server.id
  const { data: roles } = useRoles(sid)
  const { data: members } = useMembers(sid)
  const openModal = useUI((s) => s.openModal)
  const [sel, setSel] = useState<string | null>(null)
  const myTop = topPosition(ctx)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const list = useMemo(() => roles ?? [], [roles])
  const custom = useMemo(() => list.filter((r) => !r.is_default).sort((a, b) => b.position - a.position), [list])
  const def = list.find((r) => r.is_default)
  const role = list.find((r) => r.id === sel)
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    members?.forEach((mem) => mem.member_roles.forEach((r) => m.set(r.role_id, (m.get(r.role_id) ?? 0) + 1)))
    return m
  }, [members])
  const refresh = () => qc.invalidateQueries({ queryKey: qk.roles(sid) })
  const lockedIds = new Set(custom.filter((r) => r.position >= myTop).map((r) => r.id))
  const lockedCount = custom.filter((r) => lockedIds.has(r.id)).length

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = custom.findIndex((r) => r.id === active.id)
    const to = custom.findIndex((r) => r.id === over.id)
    if (from < 0 || to < 0) return
    if (to < lockedCount) return void toast.error('Um cargo não pode ficar acima ou no mesmo nível do seu próprio cargo.')
    const next = arrayMove(custom, from, to)
    const prev = qc.getQueryData<Role[]>(qk.roles(sid))
    // atualização otimista (posições provisórias na mesma ordem enviada ao banco)
    const n = next.length
    qc.setQueryData<Role[]>(qk.roles(sid), (old) => (old ?? []).map((r) => { const i = next.findIndex((x) => x.id === r.id); return i >= 0 ? { ...r, position: (n - i) * 10 } : r }))
    try {
      await rpc('reorder_roles', { p_server: sid, p_order: next.map((r) => r.id) })
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err))
      qc.setQueryData(qk.roles(sid), prev)
    }
  }

  return (
    <div>
      <H>Cargos</H>
      <p className="mt-0 mb-4 text-fg-2">Arraste para definir a hierarquia: cargos mais acima têm mais poder sobre os de baixo. A cor do cargo define a cor do nome.</p>
      <div className="flex flex-col gap-5 md:flex-row">
        <div className="md:w-72 md:shrink-0">
          <button className="btn btn-primary mb-3 w-full" onClick={() => openModal(<CreateRoleModal ctx={ctx} onCreated={(id) => { void refresh(); setSel(id) }} />)} disabled={!hasPerm(ctx, 'manage_roles')}><Plus size={14} /> Criar cargo</button>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
            <SortableContext items={custom.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Cargos em ordem de hierarquia">
                {custom.map((r) => <RoleRow key={r.id} role={r} selected={sel === r.id} locked={lockedIds.has(r.id)} count={counts.get(r.id) ?? 0} onSelect={() => setSel(r.id)} />)}
                {def && <RoleRow role={def} selected={sel === def.id} locked count={members?.length ?? 0} onSelect={() => setSel(def.id)} />}
              </ul>
            </SortableContext>
          </DndContext>
        </div>
        <div className="min-w-0 flex-1">
          {role ? <RoleEditor key={role.id} role={role} ctx={ctx} onChanged={refresh} onDeleted={() => { setSel(null); void refresh() }} /> : <EmptyState icon={<Shield />} title="Selecione um cargo">Edite nome, cor, permissões e quem faz parte dele.</EmptyState>}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- editor */
function RoleEditor({ role, ctx, onChanged, onDeleted }: { role: Role; ctx: PermContext; onChanged: () => void; onDeleted: () => void }) {
  const myTop = topPosition(ctx)
  const isOwner = ctx.server.owner_id === ctx.member?.user_id
  const locked = !isOwner && role.position >= myTop && !(role.is_default && myTop > 0)
  const [tab, setTab] = useState<'geral' | 'perms' | 'membros'>('geral')
  const [name, setName] = useState(role.name)
  const [color, setColor] = useState(role.color)
  const [hoist, setHoist] = useState(role.hoist)
  const [perms, setPerms] = useState(new Set(role.permissions))
  const { busy, run } = useAction()
  const dirty = name !== role.name || color !== role.color || hoist !== role.hoist || perms.size !== role.permissions.length || role.permissions.some((p) => !perms.has(p))

  const save = () => run(async () => {
    await rpc('update_role', { p_role: role.id, p_name: name, p_color: color, p_permissions: [...perms], p_position: null, p_hoist: hoist })
    onChanged()
    toast.success('Cargo salvo.')
  })

  return (
    <div>
      {locked && <p className="card mb-3 text-fg-2">Este cargo está no seu nível ou acima: você não pode editá-lo.</p>}
      <div className="mb-4 flex gap-1 border-b border-border" role="tablist">
        {([['geral', 'Exibição'], ['perms', 'Permissões'], ['membros', 'Membros']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx('-mb-px border-0 border-b-2 bg-transparent px-3 py-2 font-semibold', tab === k ? 'border-[var(--accent)] text-fg' : 'border-transparent text-fg-2 hover:text-fg')}>{l}</button>
        ))}
      </div>

      {tab === 'geral' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="field"><label htmlFor="r-n">Nome do cargo</label><input id="r-n" className="input" value={name} maxLength={50} disabled={locked || role.is_default} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="r-c">Cor</label><input id="r-c" type="color" className="h-[38px] w-14 cursor-pointer rounded border-0 bg-transparent p-0" value={color} disabled={locked} onChange={(e) => setColor(e.target.value)} /></div>
          </div>
          {!role.is_default && (
            <div className="flex items-center justify-between gap-4">
              <div><div className="font-semibold">Exibir membros separadamente</div><div className="text-xs text-fg-muted">Cria um grupo próprio para este cargo na lista de membros.</div></div>
              <Toggle checked={hoist} onChange={setHoist} label="Exibir membros separadamente" disabled={locked} />
            </div>
          )}
        </div>
      )}

      {tab === 'perms' && (
        <div className="flex flex-col">
          {(['geral', 'texto', 'voz'] as const).map((g) => (
            <div key={g} className="mb-2">
              <div className="label mb-1">{g === 'geral' ? 'Gerais' : g === 'texto' ? 'Texto' : 'Voz e vídeo'}</div>
              {PERMISSIONS.filter((p) => p.group === g).map((p) => (
                <div key={p.key} className="flex items-center justify-between gap-4 border-b border-border py-2">
                  <div className="min-w-0"><div className="font-semibold">{p.label}</div><div className="text-xs text-fg-muted">{p.description}</div></div>
                  <Toggle checked={perms.has(p.key)} label={p.label} disabled={locked || !hasPerm(ctx, p.key)} onChange={(v) => setPerms((s) => { const n = new Set(s); if (v) n.add(p.key); else n.delete(p.key); return n })} />
                </div>
              ))}
            </div>
          ))}
          <p className="hint">Você só pode conceder permissões que você mesmo tem.</p>
        </div>
      )}

      {tab === 'membros' && <RoleMembers role={role} ctx={ctx} />}

      {tab !== 'membros' && (
        <div className="mt-5 flex gap-2">
          <button className="btn btn-primary" disabled={busy || !dirty || locked} onClick={() => void save()}>{busy && <Spinner size={14} />} Salvar alterações</button>
          {!role.is_default && <button className="btn btn-danger" disabled={locked} onClick={() => confirmAction({ title: `Excluir cargo “${role.name}”`, message: 'Os membros perderão este cargo.', confirmLabel: 'Excluir', danger: true, onConfirm: async () => { await rpc('delete_role', { p_role: role.id }); onDeleted() } })}><Trash2 size={14} /> Excluir</button>}
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- membros */
function RoleMembers({ role, ctx }: { role: Role; ctx: PermContext }) {
  const qc = useQueryClient()
  const me = useSession((s) => s.user!.id)
  const { data: members, isLoading } = useMembers(ctx.server.id)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  if (role.is_default) return <p className="card text-fg-2">Todos os membros do servidor têm este cargo automaticamente.</p>
  if (isLoading || !members) return <Spinner />

  const has = (m: Member) => m.member_roles.some((r) => r.role_id === role.id)
  const filtered = members
    .filter((m) => (!only || has(m)) && `${m.profile?.display_name} ${m.profile?.username} ${m.nickname ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(has(b)) - Number(has(a)))

  const toggle = async (m: Member) => {
    const grant = !has(m)
    setBusy(m.user_id)
    try {
      await rpc('set_member_role', { p_server: ctx.server.id, p_user: m.user_id, p_role: role.id, p_grant: grant })
      await qc.invalidateQueries({ queryKey: qk.members(ctx.server.id) })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1"><Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" /><input className="input pl-9" placeholder="Buscar membro" aria-label="Buscar membro" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-fg-2"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Só quem tem</label>
      </div>
      <p className="hint mb-2">{members.filter(has).length} de {members.length} membros têm este cargo.</p>
      <ul className="m-0 list-none p-0">
        {filtered.map((m) => {
          const allowed = canAssign(ctx, me, m, role, !has(m))
          return (
            <li key={m.user_id}>
              <label className={clsx('flex items-center gap-3 rounded-md px-2 py-1.5', allowed ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : 'cursor-not-allowed opacity-60')} title={allowed ? undefined : 'Você não pode alterar os cargos desta pessoa.'}>
                <input type="checkbox" checked={has(m)} disabled={!allowed || busy === m.user_id} onChange={() => void toggle(m)} aria-label={`${m.profile?.display_name} no cargo ${role.name}`} />
                <Avatar path={m.profile?.avatar_path} name={m.profile?.display_name ?? '?'} id={m.user_id} size={28} />
                <span className="min-w-0 flex-1 truncate font-medium">{m.nickname || m.profile?.display_name || m.profile?.username}</span>
                <span className="text-xs text-fg-muted">@{m.profile?.username}</span>
                {busy === m.user_id && <Spinner size={14} />}
              </label>
            </li>
          )
        })}
        {!filtered.length && <li className="py-4 text-center text-fg-muted">Nenhum membro encontrado.</li>}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------- criar cargo */
function CreateRoleModal({ ctx, onCreated }: { ctx: PermContext; onCreated: (id: string) => void }) {
  const close = useCloseModal()
  const me = useSession((s) => s.user!.id)
  const { data: members } = useMembers(ctx.server.id)
  const [name, setName] = useState('Novo cargo')
  const [color, setColor] = useState('#5865f2')
  const [hoist, setHoist] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const { busy, run } = useAction()
  const [error, setError] = useState<string | null>(null)

  // permissões mínimas do cargo novo: nenhuma (editáveis depois)
  const fake: Role = { id: 'new', server_id: ctx.server.id, name, color, position: 1, permissions: [], is_default: false, hoist }
  const choices = (members ?? []).filter((m) => canAssign(ctx, me, m, fake, true) && `${m.profile?.display_name} ${m.profile?.username}`.toLowerCase().includes(q.toLowerCase()))

  const create = () => run(async () => {
    const id = await rpc<string>('create_role', { p_server: ctx.server.id, p_name: name, p_color: color, p_permissions: [], p_hoist: hoist, p_members: [...picked] })
    onCreated(id)
    close()
    toast.success('Cargo criado.')
  }, { onError: (e) => setError(errorMessage(e)) })

  return (
    <Modal title="Criar cargo" description="Defina nome e cor e, se quiser, já adicione pessoas. As permissões são ajustadas depois."
      footer={<><button className="btn btn-ghost" onClick={close}>Cancelar</button><button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void create()}>{busy && <Spinner size={14} />} Criar cargo</button></>}>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="field"><label htmlFor="nr-n">Nome do cargo</label><input id="nr-n" className="input" value={name} maxLength={50} autoFocus onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="nr-c">Cor</label><input id="nr-c" type="color" className="h-[38px] w-14 cursor-pointer rounded border-0 bg-transparent p-0" value={color} onChange={(e) => setColor(e.target.value)} /></div>
      </div>
      <div className="my-4 flex items-center justify-between gap-4">
        <div className="font-semibold">Exibir membros separadamente</div>
        <Toggle checked={hoist} onChange={setHoist} label="Exibir membros separadamente" />
      </div>
      <div className="label mb-1">Adicionar membros ({picked.size})</div>
      <input className="input mb-2" placeholder="Buscar membro" aria-label="Buscar membro" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="m-0 max-h-56 list-none overflow-y-auto p-0">
        {choices.map((m) => (
          <li key={m.user_id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]">
              <input type="checkbox" checked={picked.has(m.user_id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(m.user_id); else n.delete(m.user_id); return n })} />
              <Avatar path={m.profile?.avatar_path} name={m.profile?.display_name ?? '?'} id={m.user_id} size={26} />
              <span className="flex-1 truncate font-medium">{m.nickname || m.profile?.display_name || m.profile?.username}</span>
              <span className="text-xs text-fg-muted">@{m.profile?.username}</span>
            </label>
          </li>
        ))}
        {!choices.length && <li className="py-3 text-center text-fg-muted">Nenhum membro disponível.</li>}
      </ul>
      {error && <p className="error-text mt-3" role="alert">{error}</p>}
    </Modal>
  )
}
