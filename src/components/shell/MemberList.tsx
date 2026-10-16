import { useMemo } from 'react'
import { Clock, Crown } from 'lucide-react'
import { highestRole } from '@/lib/perms'
import { useReadable } from '@/lib/useReadable'
import { useMembers, usePermCtx, useRoles } from '@/data/queries'
import { useVoiceMove } from '@/data/voiceMove'
import { presenceOfUser, usePresenceStore } from '@/data/presence'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'
import { Avatar, CenterSpinner } from '@/components/ui'
import { useLocalNick, useUserMenu } from '@/components/userMenu'
import type { Member, Presence, Role } from '@/lib/types'

export function MemberList({ serverId }: { serverId: string }) {
  const { data: members, isLoading } = useMembers(serverId)
  const { data: roles } = useRoles(serverId)
  const ctx = usePermCtx(serverId)
  const byTopic = usePresenceStore((s) => s.byTopic)
  const me = useSession((s) => s.user!.id)
  const openProfile = useUI((s) => s.openProfile)
  const userMenu = useUserMenu(serverId)
  const localNick = useLocalNick()
  const readable = useReadable('secondary')
  const mv = useVoiceMove(serverId)

  const groups = useMemo(() => {
    if (!members || !roles) return []
    const status = (m: Member): Presence => (m.user_id === me ? presenceOfUser(byTopic, me) || 'online' : presenceOfUser(byTopic, m.user_id))
    const online = members.filter((m) => m.profile?.is_bot || status(m) !== 'offline' || (m.user_id === me && m.profile?.status_pref !== 'invisible'))
    const offline = members.filter((m) => !online.includes(m))
    const buckets = new Map<string, { role: Role | null; items: Member[] }>()
    for (const m of online) {
      // só cargos com "exibir separadamente" formam grupo; o maior deles define o grupo do membro
      const mine = new Set(m.member_roles.map((r) => r.role_id))
      const top = roles.filter((r) => r.hoist && !r.is_default && mine.has(r.id)).sort((a, b) => b.position - a.position)[0]
      const key = top?.id ?? 'online'
      const b = buckets.get(key) ?? { role: top ?? null, items: [] }
      b.items.push(m)
      buckets.set(key, b)
    }
    const ordered = [...buckets.values()].sort((a, b) => (b.role?.position ?? -1) - (a.role?.position ?? -1))
    return [
      ...ordered.map((b) => ({ key: b.role?.id ?? 'online', title: b.role?.name ?? 'Online', items: b.items })),
      ...(offline.length ? [{ key: 'offline', title: 'Offline', items: offline }] : []),
    ]
  }, [members, roles, byTopic, me])

  if (isLoading || !ctx) return <CenterSpinner />

  return (
    <div className="h-full overflow-y-auto bg-secondary px-2 pt-4 pb-6" aria-label="Membros do servidor">
      {groups.map((g) => (
        <section key={g.key} className="mb-4">
          <h3 className="m-0 px-2 pt-1 pb-1.5 text-xs font-bold tracking-wide text-fg-muted uppercase">{g.title} — {g.items.length}</h3>
          {g.items.map((m) => {
            const st: Presence = g.key === 'offline' ? 'offline' : presenceOfUser(byTopic, m.user_id) === 'offline' ? 'online' : presenceOfUser(byTopic, m.user_id)
            const timedOut = !!m.timeout_until && new Date(m.timeout_until) > new Date()
            const top = roles ? highestRole(roles, m) : undefined
            const name = localNick(m.user_id, m.nickname || m.profile?.display_name || m.profile?.username || 'Membro')
            return (
              <button
                key={m.user_id}
                className="flex h-[42px] w-full items-center gap-3 rounded-md border-0 bg-transparent px-2 text-left hover:bg-[var(--bg-hover)]"
                style={{ opacity: g.key === 'offline' ? 0.55 : 1 }}
                onClick={(e) => openProfile(m.user_id, serverId, e.clientX - 350, e.clientY)}
                onContextMenu={(e) => userMenu(m.user_id, e)}
                aria-label={`${name}, ${st}`}
                {...mv.dragProps(m.user_id)}
              >
                <Avatar path={m.profile?.avatar_path} name={name} id={m.user_id} size={32} status={st} ring="var(--bg-secondary)" />
                <span className="min-w-0 leading-tight">
                  <span className="flex items-center gap-1 truncate font-medium" style={{ color: readable(top?.color) ?? 'var(--text-secondary)' }}>
                    {name}
                    {ctx.server.owner_id === m.user_id && <Crown size={14} className="shrink-0 text-warning" aria-label="Dono do servidor" />}
                    {timedOut && <Clock size={13} className="shrink-0 text-warning" aria-label="De castigo" />}
                    {m.profile?.is_bot && <span className="shrink-0 rounded bg-[var(--accent)] px-1 text-[10px] leading-4 font-bold text-[var(--accent-contrast)]" aria-label="Aplicativo (bot)">APP</span>}
                  </span>
                  {m.profile?.custom_status && <span className="block truncate text-xs text-fg-muted">{m.profile.custom_status}</span>}
                </span>
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}
