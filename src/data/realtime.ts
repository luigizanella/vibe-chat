import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { fetchMessage, messagesKey, patchMessages, upsertMessage, type MessagesState, type Scope } from './messages'
import { qk } from './queries'
import { useSession } from '@/store/session'
import { useUI } from '@/store/ui'
import { useSettings } from '@/store/settings'
import { playSound } from '@/lib/sounds'
import { desktopNotify, flashTitle } from '@/lib/notify'
import type { Channel, Member, Message, MiniProfile, NotifPref, Profile, Server } from '@/lib/types'
import { useVoice } from '@/store/voice'

type Row = Record<string, unknown>
type Payload = RealtimePostgresChangesPayload<Row>

let markReadTimer: ReturnType<typeof setTimeout> | undefined
function markReadSoon(qc: QueryClient, scope: Scope) {
  clearTimeout(markReadTimer)
  markReadTimer = setTimeout(() => {
    void supabase
      .rpc('mark_read', scope.kind === 'channel' ? { p_channel: scope.id } : { p_dm: scope.id })
      .then(() => qc.invalidateQueries({ queryKey: qk.unread }))
  }, 600)
}

function findChannel(qc: QueryClient, id: string): Channel | undefined {
  for (const [, list] of qc.getQueriesData<Channel[]>({ queryKey: ['channels'] })) {
    const c = list?.find((x) => x.id === id)
    if (c) return c
  }
}

async function authorOf(qc: QueryClient, id: string | null): Promise<MiniProfile | null> {
  if (!id) return null
  const p = await qc.fetchQuery({
    queryKey: qk.profile(id),
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
      return data as Profile | null
    },
  })
  return p
}

async function handleIncoming(qc: QueryClient, row: Message) {
  const me = useSession.getState().user?.id
  if (!me || row.author_id === me) return
  const ui = useUI.getState()
  const scope: Scope = row.channel_id ? { kind: 'channel', id: row.channel_id } : { kind: 'dm', id: row.dm_id! }
  const viewing = (scope.kind === 'channel' ? ui.activeChannelId === scope.id : ui.activeDmId === scope.id) &&
    document.hasFocus() && document.visibilityState === 'visible'
  if (viewing) {
    markReadSoon(qc, scope)
    return
  }
  void qc.invalidateQueries({ queryKey: qk.unread })

  const settings = useSettings.getState().settings
  const prefs = qc.getQueryData<NotifPref[]>(qk.notifPrefs) ?? []
  let serverId: string | null = null
  let channel: Channel | undefined
  if (row.channel_id) {
    channel = findChannel(qc, row.channel_id)
    serverId = channel?.server_id ?? null
  }
  const chanPref = prefs.find((p) => (scope.kind === 'channel' ? p.channel_id === scope.id : p.dm_id === scope.id))
  const srvPref = serverId ? prefs.find((p) => p.server_id === serverId) : undefined
  if (chanPref?.muted || srvPref?.muted) return

  let mentioned = row.mention_user_ids?.includes(me) || row.mention_everyone
  if (!mentioned && serverId && row.mention_role_ids?.length) {
    const members = qc.getQueryData<Member[]>(qk.members(serverId))
    const mine = members?.find((m) => m.user_id === me)
    mentioned = !!mine?.member_roles.some((r) => row.mention_role_ids.includes(r.role_id))
  }
  const level = chanPref?.level ?? srvPref?.level ?? 'all'
  if (level === 'none') return
  const isDm = scope.kind === 'dm'
  if ((level === 'mentions' || (settings.notifications.mentionsOnly && !isDm)) && !mentioned && !isDm) return

  const inCall = !!useVoice.getState().room
  playSound(mentioned ? 'mention' : 'message')
  if (inCall && settings.notifications.muteInCall) return
  const author = row.author ?? (await authorOf(qc, row.author_id))
  const who = author?.display_name || author?.username || 'Alguém'
  const where = channel ? `#${channel.name}` : 'mensagem direta'
  const body = row.content ? row.content.slice(0, 140) : '📎 Anexo'
  flashTitle(`💬 ${who}`)
  void desktopNotify(`${who} — ${where}`, body)
}

async function onMessageEvent(qc: QueryClient, payload: Payload) {
  if (payload.eventType === 'DELETE') {
    const id = (payload.old as Row).id as string
    for (const [key] of qc.getQueriesData<MessagesState>({ queryKey: ['messages'] })) {
      patchMessages(qc, key, (s) => ({ ...s, items: s.items.filter((m) => m.id !== id) }))
    }
    void qc.invalidateQueries({ queryKey: ['pins'] })
    return
  }
  const raw = payload.new as unknown as Message
  const scope: Scope = raw.channel_id ? { kind: 'channel', id: raw.channel_id } : { kind: 'dm', id: raw.dm_id! }
  const key = messagesKey(scope)
  const cached = qc.getQueryData<MessagesState>(key)
  const full = await fetchMessage(raw.id)
  if (!full) return
  if (cached) patchMessages(qc, key, (s) => upsertMessage(s, full))
  if (payload.eventType === 'INSERT') {
    if (raw.dm_id) void qc.invalidateQueries({ queryKey: qk.dms })
    await handleIncoming(qc, full)
  } else {
    void qc.invalidateQueries({ queryKey: ['pins'] })
  }
}

async function onReactionEvent(qc: QueryClient, payload: Payload) {
  const r = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Row
  const mid = r.message_id as string
  for (const [key, state] of qc.getQueriesData<MessagesState>({ queryKey: ['messages'] })) {
    if (!state?.items.some((m) => m.id === mid)) continue
    const full = await fetchMessage(mid)
    if (full) patchMessages(qc, key, (s) => upsertMessage(s, full))
  }
}

function sid(payload: Payload): string | undefined {
  return ((payload.new as Row)?.server_id ?? (payload.old as Row)?.server_id) as string | undefined
}

export function useRealtimeSync() {
  const qc = useQueryClient()
  const uid = useSession((s) => s.user?.id)

  useEffect(() => {
    if (!uid) return
    let everSubscribed = false
    const invalidateServer = (key: string, p: Payload) => {
      const s = sid(p)
      void qc.invalidateQueries({ queryKey: s ? [key, s] : [key] })
      if (key !== 'categories') void qc.invalidateQueries({ queryKey: ['cansend'] })
    }

    const channel = supabase
      .channel(`db:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (p) => void onMessageEvent(qc, p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, (p) => void onReactionEvent(qc, p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attachments' }, () => undefined)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servers' }, (p) => {
        void qc.invalidateQueries({ queryKey: qk.servers })
        if (p.eventType === 'DELETE') {
          const id = (p.old as Row).id as string
          qc.removeQueries({ queryKey: ['channels', id] })
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, (p) => {
        invalidateServer('members', p)
        // fui removido/saí? atualiza a lista de servidores
        const u = ((p.old as Row)?.user_id ?? (p.new as Row)?.user_id) as string | undefined
        if (u === uid) void qc.invalidateQueries({ queryKey: qk.servers })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_roles' }, (p) => invalidateServer('members', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roles' }, (p) => invalidateServer('roles', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, (p) => invalidateServer('channels', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, (p) => invalidateServer('categories', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => {
        void qc.invalidateQueries({ queryKey: qk.friends })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_participants' }, () => {
        void qc.invalidateQueries({ queryKey: qk.dms })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_conversations' }, () => {
        void qc.invalidateQueries({ queryKey: qk.dms })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (p) => {
        const prof = p.new as unknown as Profile
        qc.setQueryData(qk.profile(prof.id), prof)
        void qc.invalidateQueries({ queryKey: ['members'] })
        void qc.invalidateQueries({ queryKey: qk.dms })
        void qc.invalidateQueries({ queryKey: qk.friends })
        for (const [key] of qc.getQueriesData<MessagesState>({ queryKey: ['messages'] })) {
          patchMessages(qc, key, (s) => ({
            ...s,
            items: s.items.map((m) =>
              m.author_id === prof.id
                ? { ...m, author: { id: prof.id, username: prof.username, display_name: prof.display_name, avatar_path: prof.avatar_path } }
                : m,
            ),
          }))
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // ao (re)conectar, revalida tudo que pode ter mudado durante a queda
          if (everSubscribed) void qc.invalidateQueries()
          everSubscribed = true
        }
      })

    const onOnline = () => void qc.invalidateQueries()
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      void supabase.removeChannel(channel)
    }
  }, [uid, qc])
}

export type { Server }
