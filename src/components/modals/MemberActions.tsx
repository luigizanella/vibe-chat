import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Ban, Crown, LogOut, MessageSquare, Shield, User as UserIcon, UserX } from 'lucide-react'
import type { NavigateFunction } from 'react-router-dom'
import { rpc } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { hasPerm, topPosition, type PermContext } from '@/lib/perms'
import type { Member, Role } from '@/lib/types'
import { qk } from '@/data/queries'
import { Avatar, Modal, confirmAction, useCloseModal } from '@/components/ui'
import { toast, useUI, type MenuItem } from '@/store/ui'

export function MemberRolesModal({ serverId, member, roles, ctx }: { serverId: string; member: Member; roles: Role[]; ctx: PermContext }) {
  const close = useCloseModal()
  const qc = useQueryClient()
  const [owned, setOwned] = useState(new Set(member.member_roles.map((r) => r.role_id)))
  const [busy, setBusy] = useState<string | null>(null)
  const myTop = topPosition(ctx)
  const name = member.profile?.display_name || member.profile?.username || 'Membro'

  const toggle = async (r: Role) => {
    const grant = !owned.has(r.id)
    setBusy(r.id)
    try {
      await rpc('set_member_role', { p_server: serverId, p_user: member.user_id, p_role: r.id, p_grant: grant })
      setOwned((s) => {
        const n = new Set(s)
        if (grant) n.add(r.id)
        else n.delete(r.id)
        return n
      })
      await qc.invalidateQueries({ queryKey: qk.members(serverId) })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal title={`Cargos de ${name}`} description="Você só pode atribuir cargos abaixo do seu nível." footer={<button className="btn btn-primary" onClick={close}>Concluir</button>}>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {roles.filter((r) => !r.is_default).map((r) => {
          const locked = r.position >= myTop
          return (
            <li key={r.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-[var(--bg-hover)]" style={{ opacity: locked ? 0.5 : 1 }}>
                <input type="checkbox" checked={owned.has(r.id)} disabled={locked || busy === r.id} onChange={() => void toggle(r)} />
                <span className="h-3 w-3 rounded-full" style={{ background: r.color }} />
                <span className="flex-1 font-semibold">{r.name}</span>
                {locked && <span className="text-xs text-fg-muted">acima do seu nível</span>}
              </label>
            </li>
          )
        })}
      </ul>
      {roles.filter((r) => !r.is_default).length === 0 && <p className="text-fg-muted">Este servidor ainda não tem cargos personalizados.</p>}
    </Modal>
  )
}

export function askReason(title: string, confirmLabel: string, onConfirm: (reason: string) => Promise<void>) {
  useUI.getState().openModal(<ReasonModal title={title} confirmLabel={confirmLabel} onConfirm={onConfirm} />)
}

function ReasonModal({ title, confirmLabel, onConfirm }: { title: string; confirmLabel: string; onConfirm: (reason: string) => Promise<void> }) {
  const close = useCloseModal()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Modal title={title} footer={<><button className="btn btn-ghost" onClick={close}>Cancelar</button><button className="btn btn-danger" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(reason); close() } catch (e) { setErr(errorMessage(e)); setBusy(false) } }}>{confirmLabel}</button></>}>
      <div className="field"><label htmlFor="reason">Motivo (opcional)</label><input id="reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
      {err && <p className="error-text mt-2" role="alert">{err}</p>}
    </Modal>
  )
}

/** Itens de menu de contexto para um membro de servidor. */
export function memberMenuItems(opts: {
  ctx: PermContext
  member: Member
  roles: Role[]
  me: string
  nav: NavigateFunction
  qc: ReturnType<typeof useQueryClient>
  openProfileAt?: () => void
  onBlock?: () => void
}): MenuItem[] {
  const { ctx, member, roles, me, nav, qc } = opts
  const sid = ctx.server.id
  const isSelf = member.user_id === me
  const targetIsOwner = ctx.server.owner_id === member.user_id
  const myTop = topPosition(ctx)
  const theirTop = topPosition({ server: ctx.server, roles, member }, member.user_id)
  const outranks = !isSelf && !targetIsOwner && myTop > theirTop
  const name = member.profile?.display_name || member.profile?.username || 'membro'
  const open = useUI.getState().openModal
  const afterMod = () => qc.invalidateQueries({ queryKey: qk.members(sid) })

  const items: MenuItem[] = []
  if (opts.openProfileAt) items.push({ label: 'Perfil', icon: <UserIcon size={14} />, onClick: opts.openProfileAt })
  if (!isSelf) {
    items.push({
      label: 'Enviar mensagem',
      icon: <MessageSquare size={14} />,
      onClick: () => rpc<string>('open_dm', { p_user: member.user_id }).then((id) => { void qc.invalidateQueries({ queryKey: qk.dms }); nav(`/app/@me/${id}`) }, (e) => toast.error(errorMessage(e))),
    })
  }
  if (hasPerm(ctx, 'manage_roles') && (outranks || isSelf)) {
    items.push({ label: 'Gerenciar cargos', icon: <Shield size={14} />, onClick: () => open(<MemberRolesModal serverId={sid} member={member} roles={roles} ctx={ctx} />) })
  }
  const mod: MenuItem[] = []
  if (hasPerm(ctx, 'kick_members') && outranks)
    mod.push({ label: `Expulsar ${name}`, icon: <UserX size={14} />, danger: true, onClick: () => open(<ReasonModal title={`Expulsar ${name}`} confirmLabel="Expulsar" onConfirm={async (reason) => { await rpc('kick_member', { p_server: sid, p_user: member.user_id, p_reason: reason }); await afterMod(); toast.success('Membro expulso.') }} />) })
  if (hasPerm(ctx, 'ban_members') && outranks)
    mod.push({ label: `Banir ${name}`, icon: <Ban size={14} />, danger: true, onClick: () => open(<ReasonModal title={`Banir ${name}`} confirmLabel="Banir" onConfirm={async (reason) => { await rpc('ban_member', { p_server: sid, p_user: member.user_id, p_reason: reason }); await afterMod(); toast.success('Membro banido.') }} />) })
  if (ctx.server.owner_id === me && !isSelf)
    mod.push({
      label: 'Transferir propriedade',
      icon: <Crown size={14} />,
      danger: true,
      onClick: () => confirmAction({ title: 'Transferir propriedade', message: <>Você tornará <strong>{name}</strong> o novo dono de <strong>{ctx.server.name}</strong>. Você deixará de ser dono e esta ação só pode ser desfeita por ele(a).</>, confirmLabel: 'Transferir', danger: true, requireText: ctx.server.name, onConfirm: async () => { await rpc('transfer_ownership', { p_server: sid, p_new_owner: member.user_id }); await qc.invalidateQueries({ queryKey: qk.servers }); await afterMod() } }),
    })
  if (!isSelf && opts.onBlock) mod.push({ label: 'Bloquear', icon: <Ban size={14} />, danger: true, onClick: opts.onBlock })
  if (mod.length) items.push({ separator: true }, ...mod)
  return items
}

export function MemberRow({ member, onClick, onContext }: { member: Member; onClick?: (e: React.MouseEvent) => void; onContext?: (e: React.MouseEvent) => void }) {
  const p = member.profile
  return (
    <button className="flex w-full items-center gap-2 rounded-md border-0 bg-transparent p-1.5 text-left hover:bg-[var(--bg-hover)]" onClick={onClick} onContextMenu={onContext}>
      <Avatar path={p?.avatar_path} name={p?.display_name || p?.username || '?'} id={member.user_id} size={32} />
      <span className="min-w-0 flex-1 truncate font-semibold">{member.nickname || p?.display_name || p?.username}</span>
    </button>
  )
}

export function LeaveIcon() {
  return <LogOut size={14} />
}
