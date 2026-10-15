import { useEffect, useRef, useState, useCallback } from 'react'
import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/store/session'
import { useVoice } from '@/store/voice'
import { useServers, useFriends, useDMs } from './queries'
import type { Presence } from '@/lib/types'
import type { Scope } from './messages'

interface Meta {
  status: Presence
  voice: string | null
}

interface PresenceState {
  /** estado por tópico → usuário → meta */
  byTopic: Record<string, Record<string, Meta>>
  setTopic: (topic: string, state: Record<string, Meta>) => void
  dropTopic: (topic: string) => void
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  byTopic: {},
  setTopic: (topic, state) => set({ byTopic: { ...get().byTopic, [topic]: state } }),
  dropTopic: (topic) => {
    const { [topic]: _drop, ...rest } = get().byTopic
    set({ byTopic: rest })
  },
}))

const RANK: Record<Presence, number> = { online: 3, dnd: 2, idle: 1, offline: 0 }

export function presenceOfUser(byTopic: PresenceState['byTopic'], userId: string | null | undefined): Presence {
  if (!userId) return 'offline'
  let best: Presence = 'offline'
  for (const t of Object.values(byTopic)) {
    const m = t[userId]
    if (m && RANK[m.status] > RANK[best]) best = m.status
  }
  return best
}

/** Presença consolidada de um usuário (melhor estado entre todos os tópicos). */
export function usePresenceOf(userId: string | null | undefined): Presence {
  return usePresenceStore((s) => presenceOfUser(s.byTopic, userId))
}

export function useVoiceChannelOf(userId: string): string | null {
  return usePresenceStore((s) => {
    for (const t of Object.values(s.byTopic)) if (t[userId]?.voice) return t[userId].voice
    return null
  })
}

/** Usuários conectados em cada canal de voz (via presença do servidor). */
export function useVoiceOccupants(): Record<string, string[]> {
  const byTopic = usePresenceStore((s) => s.byTopic)
  const out: Record<string, Set<string>> = {}
  for (const topic of Object.keys(byTopic)) {
    if (!topic.startsWith('srv:')) continue
    for (const [uid, m] of Object.entries(byTopic[topic])) {
      if (m.voice) (out[m.voice] ??= new Set()).add(uid)
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]))
}

const IDLE_MS = 5 * 60_000

/** Gerencia os canais de presença (servidores + amigos + próprio). Monte uma vez no AppShell. */
export function usePresenceManager() {
  const uid = useSession((s) => s.user?.id)
  const profile = useSession((s) => s.profile)
  const voiceChannel = useVoice((s) => s.channelId)
  const { data: servers } = useServers()
  const { data: friends } = useFriends()
  const { data: dms } = useDMs()
  const channels = useRef(new Map<string, { ch: RealtimeChannel; track: boolean }>())
  const [idle, setIdle] = useState(false)

  const pref = profile?.status_pref ?? 'online'
  const myStatus: Presence | null = pref === 'invisible' ? null : pref === 'online' && idle ? 'idle' : pref
  const meta = useRef<Meta | null>(null)
  meta.current = myStatus ? { status: myStatus, voice: voiceChannel } : null

  // Detecção de inatividade
  useEffect(() => {
    let last = Date.now()
    const bump = () => {
      last = Date.now()
      setIdle((v) => (v ? false : v))
    }
    const events = ['mousemove', 'keydown', 'pointerdown', 'wheel', 'touchstart']
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const iv = setInterval(() => {
      if (Date.now() - last > IDLE_MS) setIdle(true)
    }, 30_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      clearInterval(iv)
    }
  }, [])

  const wanted = new Set<string>()
  if (uid) {
    wanted.add(`fr:${uid}`)
    servers?.forEach((s) => wanted.add(`srv:${s.id}`))
    friends?.forEach((f) => wanted.add(`fr:${f.other.id}`))
    dms?.forEach((d) => d.dm_participants.forEach((p) => p.user_id !== uid && wanted.add(`fr:${p.user_id}`)))
  }
  const wantedKey = [...wanted].sort().join('|')

  // (Des)inscreve nos canais necessários
  useEffect(() => {
    if (!uid) return
    const map = channels.current
    const want = new Set(wantedKey ? wantedKey.split('|') : [])
    for (const [topic, { ch }] of map) {
      if (!want.has(topic)) {
        void supabase.removeChannel(ch)
        map.delete(topic)
        usePresenceStore.getState().dropTopic(topic)
      }
    }
    for (const topic of want) {
      if (map.has(topic)) continue
      const track = topic === `fr:${uid}` || topic.startsWith('srv:')
      const ch = supabase.channel(topic, { config: { private: true, presence: { key: uid } } })
      ch.on('presence', { event: 'sync' }, () => {
        const raw = ch.presenceState<Meta>()
        const flat: Record<string, Meta> = {}
        for (const [k, metas] of Object.entries(raw)) {
          const best = metas.slice().sort((a, b) => RANK[b.status] - RANK[a.status])[0]
          if (best) flat[k] = { status: best.status, voice: best.voice ?? null }
        }
        usePresenceStore.getState().setTopic(topic, flat)
      })
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED' && track && meta.current) void ch.track(meta.current)
      })
      map.set(topic, { ch, track })
    }
  }, [uid, wantedKey])

  // Atualiza o que eu publico quando status/voz mudam (ou fica invisível)
  const metaKey = meta.current ? `${meta.current.status}|${meta.current.voice ?? ''}` : 'off'
  useEffect(() => {
    for (const { ch, track } of channels.current.values()) {
      if (!track) continue
      if (meta.current) void ch.track(meta.current)
      else void ch.untrack()
    }
  }, [metaKey, wantedKey])

  // Limpa tudo ao sair
  useEffect(() => {
    const map = channels.current
    return () => {
      for (const { ch } of map.values()) void supabase.removeChannel(ch)
      map.clear()
      usePresenceStore.setState({ byTopic: {} })
    }
  }, [uid])
}

/** Indicador de digitação por broadcast efêmero (canal privado autorizado por RLS no Realtime). */
export function useTyping(scope: Scope | null) {
  const uid = useSession((s) => s.user?.id)
  const name = useSession((s) => s.profile?.display_name || s.profile?.username)
  const [typers, setTypers] = useState<Record<string, { name: string; at: number }>>({})
  const chRef = useRef<RealtimeChannel | null>(null)
  const lastSent = useRef(0)

  const topic = scope ? `${scope.kind === 'channel' ? 'chan' : 'dm'}:${scope.id}` : null

  useEffect(() => {
    setTypers({})
    if (!topic || !uid) return
    // O nome do canal É o tópico autorizado pelas políticas de realtime.messages (chan:<id> / dm:<id>).
    const ch = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } })
    chRef.current = ch
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const p = payload as { uid: string; name: string }
      if (p.uid === uid) return
      setTypers((t) => ({ ...t, [p.uid]: { name: p.name, at: Date.now() } }))
    })
    ch.subscribe()
    const iv = setInterval(() => {
      setTypers((t) => {
        const now = Date.now()
        const next = Object.fromEntries(Object.entries(t).filter(([, v]) => now - v.at < 5000))
        return Object.keys(next).length === Object.keys(t).length ? t : next
      })
    }, 1000)
    return () => {
      clearInterval(iv)
      void supabase.removeChannel(ch)
      chRef.current = null
    }
  }, [topic, uid])

  const ping = useCallback(() => {
    const now = Date.now()
    if (!chRef.current || now - lastSent.current < 3000) return
    lastSent.current = now
    void chRef.current.send({ type: 'broadcast', event: 'typing', payload: { uid, name } })
  }, [uid, name])

  const clearOne = useCallback((id: string) => setTypers((t) => {
    const { [id]: _x, ...rest } = t
    return rest
  }), [])

  return { typers: Object.entries(typers).map(([id, v]) => ({ id, name: v.name })), ping, clearOne }
}
