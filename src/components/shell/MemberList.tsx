import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Crown } from 'lucide-react'
import { highestRole } from '@/lib/perms'
import { useMembers, usePermCtx, useRoles } from '@/data/queries'
import { presenceOfUser, usePresenceStore } from '@/data/presence'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'
import { rpc } from '@/lib/supabase'
import { qk } from '@/data/queries'
import { toast } from '@/store/ui'
import { errorMessage } from '@/lib/errors'
import { Avatar, CenterSpinner } from '@/components/ui'
import { memberMenuItems } from '@/components/modals/MemberActions'
import type { Member, Presence, Role } from '@/lib/types'

export function MemberList({ serverId }: { serverId: string }) {
  const { data: members, isLoading } = useMembers(serverId)
  const { data: roles } = useRoles(serverId)
  const ctx = usePermCtx(serverId)
  const byTopic = usePresenceStore((s) => s.byTopic)
  const me = useSession((s) => s.user!.id)
  const nav = useNavigate()
  const qc = useQueryClient()
  const openProfile = useUI((s) => s.openProfile)
  const openMenu = useUI((s) => s.openMenu)

  const groups = useMemo(() => {
    if (!members || !roles) return []
    const status = (m: Member): Presence => (m.user_id === me ? presenceOfUser(byTopic, me) || 'online' : presenceOfUser(byTopic, m.user_id))
    const online = members.filter((m) => status(m) !== 'offline' || m.user_id === me && m.profile?.status_pref !== 'invisible')
    const offline = members.filter((m) => !online.includes(m))
    const buckets = new Map<string, { role: Role | null; items: Member[] }>()
    for (const m of online) {
      const top = highestRole(roles, m)
      const key = top?.id ?? 'online'
      const b = buckets.get(key) ?? { role: top ?? null, items: [] }
      b.items.push(m)
      buckets.set(key, b)
    }
    const ordered = [...buckets.values()].sort((a, b) => (b.role?.position ?? -1) - (a.role?.position ?? -1))
    return [
      ...ordered.map((b) => ({ key: b.role?.id ?? 'online', title: b.role?.name ?? 'Online', color: b.role?.color, items: b.items })),
      ...(offline.length ? [{ key: 'offline', title: 'Offline', color: undefined, items: offline }] : []),
    ]
  }, [members, roles, byTopic, me])

  if (isLoading || !ctx) return <CenterSpinner />

  const menuFor = (m: Member, e: React.MouseEvent) => {
    e.preventDefault()
    const items = memberMenuItems({
      ctx, member: m, roles: roles ?? [], me, nav, qc,
      openProfileAt: () => openProfile(m.user_id, serverId, e.clientX, e.clientY),
      onBlock: () => void rpc('block_user', { p_user: m.user_id }).then(() => { toast.success('Usuário bloqueado.'); void qc.invalidateQueries({ queryKey: qk.blocks }) }, (err) => toast.error(errorMessage(err))),
    })
    openMenu(e.clientX, e.clientY, items)
  }

  return (
    <div className="h-full overflow-y-auto bg-secondary px-2 pt-4 pb-6" aria-label="Membros do servidor">
      {groups.map((g) => (
        <section key={g.key} className="mb-4">
          <h3 className="m-0 px-2 pb-1 text-xs font-bold tracking-wide text-fg-muted uppercase">{g.title} — {g.items.length}</h3>
          {g.items.map((m) => {
            const st = g.key === 'offline' ? 'offline' : (presenceOfUser(byTopic, m.user_id) === 'offline' ? 'online' : presenceOfUser(byTopic, m.user_id))
            const top = roles ? highestRole(roles, m) : undefined
            const name = m.nickname || m.profile?.display_name || m.profile?.username || 'Membro'
            return (
              <button key={m.user_id} className="flex w-full items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1 text-left hover:bg-[var(--bg-hover)]" style={{ opacity: g.key === 'offline' ? 0.5 : 1 }}
                onClick={(e) => openProfile(m.user_id, serverId, e.clientX - 280, e.clientY)} onContextMenu={(e) => menuFor(m, e)} aria-label={`${name}, ${st}`}>
                <Avatar path={m.profile?.avatar_path} name={name} id={m.user_id} size={32} status={st} ring="var(--bg-secondary)" />
                <span className="min-w-0 leading-tight">
                  <span className="flex items-center gap-1 truncate font-semibold" style={{ color: top?.color }}>{name}{ctx.server.owner_id === m.user_id && <Crown size={12} className="text-warning" aria-label="Dono" />}</span>
                  {m.profile?.custom_status && <span className="block truncate text-[11px] text-fg-muted">{m.profile.custom_status}</span>}
                </span>
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}
