import type { QueryClient } from '@tanstack/react-query'
import { supabase, rpc } from '@/lib/supabase'
import { toast } from '@/store/ui'
import { useSession } from '@/store/session'
import { errorMessage } from '@/lib/errors'
import { qk } from './queries'
import type { Channel, NotifPref, UnreadRow } from '@/lib/types'

type Scope = { server_id?: string; channel_id?: string; dm_id?: string }

export function findPref(prefs: NotifPref[] | undefined, s: Scope): NotifPref | undefined {
  return prefs?.find((p) => (s.server_id ? p.server_id === s.server_id : s.channel_id ? p.channel_id === s.channel_id : p.dm_id === s.dm_id))
}

/** Cria/atualiza a preferência de notificação (silenciar / nível) de um servidor, canal ou DM. */
export async function setNotifPref(qc: QueryClient, s: Scope, patch: { muted?: boolean; level?: 'all' | 'mentions' | 'none' }): Promise<void> {
  const uid = useSession.getState().user?.id
  if (!uid) return
  const prefs = qc.getQueryData<NotifPref[]>(qk.notifPrefs)
  const existing = findPref(prefs, s)
  const res = existing
    ? await supabase.from('notification_prefs').update(patch).eq('id', existing.id)
    : await supabase.from('notification_prefs').insert({ user_id: uid, ...s, ...patch })
  if (res.error) return void toast.error(errorMessage(res.error))
  await qc.invalidateQueries({ queryKey: qk.notifPrefs })
}

export async function markChannelsRead(qc: QueryClient, channels: Pick<Channel, 'id' | 'kind'>[]): Promise<void> {
  const unread = qc.getQueryData<UnreadRow[]>(qk.unread) ?? []
  const ids = channels.filter((c) => c.kind === 'text' && unread.some((u) => u.channel_id === c.id))
  await Promise.all(ids.map((c) => rpc('mark_read', { p_channel: c.id }).catch(() => undefined)))
  await qc.invalidateQueries({ queryKey: qk.unread })
}

export async function setStatus(status: 'online' | 'idle' | 'dnd' | 'invisible'): Promise<void> {
  const { user, profile, setProfile } = useSession.getState()
  if (!user || !profile) return
  setProfile({ ...profile, status_pref: status })
  const { error } = await supabase.from('profiles').update({ status_pref: status }).eq('id', user.id)
  if (error) {
    setProfile(profile)
    toast.error(errorMessage(error))
  }
}

export async function setCustomStatus(text: string): Promise<void> {
  const { user, profile, setProfile } = useSession.getState()
  if (!user || !profile) return
  const { data, error } = await supabase.from('profiles').update({ custom_status: text.slice(0, 80) }).eq('id', user.id).select().single()
  if (error) throw error
  setProfile(data)
}
