import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, unwrap, rpc } from '@/lib/supabase'
import type {
  Ban, Category, Channel, DmConversation, Friendship, Invite, Member, MiniProfile, ModLog,
  NotifPref, Profile, Role, Server, UnreadRow,
} from '@/lib/types'
import { useSession } from '@/store/session'
import type { PermContext } from '@/lib/perms'

export const qk = {
  servers: ['servers'] as const,
  channels: (sid: string) => ['channels', sid] as const,
  categories: (sid: string) => ['categories', sid] as const,
  roles: (sid: string) => ['roles', sid] as const,
  members: (sid: string) => ['members', sid] as const,
  invites: (sid: string) => ['invites', sid] as const,
  bans: (sid: string) => ['bans', sid] as const,
  modLogs: (sid: string) => ['modlogs', sid] as const,
  dms: ['dms'] as const,
  friends: ['friendships'] as const,
  blocks: ['blocks'] as const,
  unread: ['unread'] as const,
  notifPrefs: ['notifprefs'] as const,
  profile: (id: string) => ['profile', id] as const,
  pins: (scope: string) => ['pins', scope] as const,
}

export function useServers() {
  return useQuery({
    queryKey: qk.servers,
    queryFn: async () => unwrap(await supabase.from('servers').select('*').order('created_at')) as Server[],
  })
}

export function useChannels(sid: string | undefined) {
  return useQuery({
    queryKey: qk.channels(sid ?? ''),
    enabled: !!sid,
    queryFn: async () =>
      unwrap(await supabase.from('channels').select('*').eq('server_id', sid!).order('position')) as Channel[],
  })
}
export function useCategories(sid: string | undefined) {
  return useQuery({
    queryKey: qk.categories(sid ?? ''),
    enabled: !!sid,
    queryFn: async () =>
      unwrap(await supabase.from('categories').select('*').eq('server_id', sid!).order('position')) as Category[],
  })
}
export function useRoles(sid: string | undefined) {
  return useQuery({
    queryKey: qk.roles(sid ?? ''),
    enabled: !!sid,
    queryFn: async () =>
      unwrap(await supabase.from('roles').select('*').eq('server_id', sid!).order('position', { ascending: false })) as Role[],
  })
}
export function useMembers(sid: string | undefined) {
  return useQuery({
    queryKey: qk.members(sid ?? ''),
    enabled: !!sid,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('members')
          .select('*, profile:profiles(*), member_roles(role_id)')
          .eq('server_id', sid!)
          .order('joined_at'),
      ) as Member[],
  })
}

/** Contexto de permissões do usuário atual no servidor (apenas para a UI). */
export function usePermCtx(sid: string | undefined): PermContext | undefined {
  const uid = useSession((s) => s.user?.id)
  const { data: servers } = useServers()
  const { data: roles } = useRoles(sid)
  const { data: members } = useMembers(sid)
  return useMemo(() => {
    const server = servers?.find((s) => s.id === sid)
    if (!server || !roles) return undefined
    return { server, roles, member: members?.find((m) => m.user_id === uid) }
  }, [servers, roles, members, sid, uid])
}

export function useInvites(sid: string, enabled = true) {
  return useQuery({
    queryKey: qk.invites(sid),
    enabled,
    queryFn: async () => unwrap(await supabase.from('invites').select('*').eq('server_id', sid).order('created_at', { ascending: false })) as Invite[],
  })
}
export function useBans(sid: string, enabled = true) {
  return useQuery({
    queryKey: qk.bans(sid),
    enabled,
    queryFn: async () => {
      const bans = unwrap(await supabase.from('bans').select('*').eq('server_id', sid).order('created_at', { ascending: false })) as Ban[]
      if (!bans.length) return bans
      // banidos já não compartilham contexto: os perfis podem não ser legíveis; mostramos o que a RLS permitir
      const { data } = await supabase.from('profiles').select('id,username,display_name,avatar_path').in('id', bans.map((b) => b.user_id))
      const map = new Map((data as MiniProfile[] | null)?.map((p) => [p.id, p]))
      return bans.map((b) => ({ ...b, profile: map.get(b.user_id) ?? null }))
    },
  })
}
export function useModLogs(sid: string, enabled = true) {
  return useQuery({
    queryKey: qk.modLogs(sid),
    enabled,
    queryFn: async () =>
      unwrap(await supabase.from('mod_logs').select('*').eq('server_id', sid).order('created_at', { ascending: false }).limit(100)) as ModLog[],
  })
}

export function useDMs() {
  return useQuery({
    queryKey: qk.dms,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('dm_conversations')
          .select('*, dm_participants(user_id, profile:profiles(id,username,display_name,avatar_path))')
          .order('last_message_at', { ascending: false }),
      ) as DmConversation[],
  })
}

export interface FriendEntry {
  other: Profile
  status: 'friend' | 'incoming' | 'outgoing'
}

export function useFriends() {
  const uid = useSession((s) => s.user?.id)
  return useQuery({
    queryKey: qk.friends,
    enabled: !!uid,
    queryFn: async (): Promise<FriendEntry[]> => {
      const rows = unwrap(await supabase.from('friendships').select('*')) as Friendship[]
      if (!rows.length) return []
      const ids = rows.map((r) => (r.requester_id === uid ? r.addressee_id : r.requester_id))
      const { data } = await supabase.from('profiles').select('*').in('id', ids)
      const map = new Map((data as Profile[] | null)?.map((p) => [p.id, p]))
      const out: FriendEntry[] = []
      for (const r of rows) {
        const other = map.get(r.requester_id === uid ? r.addressee_id : r.requester_id)
        if (!other) continue
        out.push({
          other,
          status: r.status === 'accepted' ? 'friend' : r.requester_id === uid ? 'outgoing' : 'incoming',
        })
      }
      return out
    },
  })
}

export function useBlocks() {
  return useQuery({
    queryKey: qk.blocks,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('blocks').select('blocked_id,created_at')) as { blocked_id: string }[]
      if (!rows.length) return [] as Profile[]
      const { data } = await supabase.from('profiles').select('*').in('id', rows.map((r) => r.blocked_id))
      return (data ?? []) as Profile[]
    },
  })
}

export function useUnread() {
  return useQuery({
    queryKey: qk.unread,
    queryFn: async () => (await rpc<UnreadRow[]>('unread_summary')) ?? [],
    staleTime: 15_000,
  })
}

export function useNotifPrefs() {
  return useQuery({
    queryKey: qk.notifPrefs,
    queryFn: async () => unwrap(await supabase.from('notification_prefs').select('*')) as NotifPref[],
  })
}

export function useProfile(id: string | undefined) {
  return useQuery({
    queryKey: qk.profile(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*').eq('id', id!).maybeSingle()
      return data as Profile | null
    },
  })
}
