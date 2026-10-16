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
  /** Transmitindo a tela agora. */
  live?: boolean
  /** Câmera ligada agora. */
  cam?: boolean
  /** Último batimento (ms). Presença de voz sem batimento recente é ignorada (evita fantasmas). */
  ts?: number
}

const STALE_MS = 75_000
const HEARTBEAT_MS = 15_000
/** Presença de voz vencida (quem fechou a aba sem sair e o servidor ainda não notou). */
const fresh = (m: Meta | undefined, now = Date.now()) => !!m && (!m.voice || !m.ts || now - m.ts < STALE_MS)

/** Re-renderiza periodicamente para que presenças vencidas sumam sozinhas. */
function useTick(ms = 10_000) {
  const [, set] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(iv)
  }, [ms])
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
  // vale o batimento MAIS RECENTE (quem trocou de status por último), não o status 'mais alto' de um tópico velho
  let best: Presence = 'offline'
  let bestTs = -1
  for (const t of Object.values(byTopic)) {
    const m = t[userId]
    if (!m) continue
    const ts = m.ts ?? 0
    if (ts > bestTs || (ts === bestTs && RANK[m.status] > RANK[best])) {
      best = m.status
      bestTs = ts
    }
  }
  return best
}

/** Presença consolidada de um usuário (melhor estado entre todos os tópicos). */
export function usePresenceOf(userId: string | null | undefined): Presence {
  return usePresenceStore((s) => presenceOfUser(s.byTopic, userId))
}

export function useVoiceChannelOf(userId: string): string | null {
  useTick()
  return usePresenceStore((s) => {
    for (const t of Object.values(s.byTopic)) if (t[userId]?.voice && fresh(t[userId])) return t[userId].voice
    return null
  })
}

/** Usuários conectados em cada canal de voz (via presença do servidor). */
/** Quem está transmitindo a tela (por usuário), segundo a presença do servidor. */
export function useLiveUsers(): Set<string> {
  const byTopic = usePresenceStore((s) => s.byTopic)
  useVoice((s) => s.participants) // re-renderiza quando a LiveKit muda
  useTick()
  const out = new Set<string>()
  for (const topic of Object.keys(byTopic)) if (topic.startsWith('srv:')) for (const [uid, m] of Object.entries(byTopic[topic])) if (m.live && m.voice && fresh(m)) out.add(uid)
  // na chamada em que estou, o estado REAL da LiveKit (tracks publicados) manda
  const { status, participants } = useVoice.getState()
  if (status === 'connected') for (const p of participants) {
    if (p.screenOn) out.add(p.identity)
    else out.delete(p.identity)
  }
  return out
}

/** Quem está com a câmera ligada numa chamada (presença do servidor). */
export function useCamUsers(): Set<string> {
  const byTopic = usePresenceStore((s) => s.byTopic)
  useVoice((s) => s.participants)
  useTick()
  const out = new Set<string>()
  for (const topic of Object.keys(byTopic)) if (topic.startsWith('srv:')) for (const [uid, m] of Object.entries(byTopic[topic])) if (m.cam && m.voice && fresh(m)) out.add(uid)
  const { status, participants } = useVoice.getState()
  if (status === 'connected') for (const p of participants) {
    if (p.camOn) out.add(p.identity)
    else out.delete(p.identity)
  }
  return out
}

/** Todos que estão em algum canal de voz (presença recente OU participante conectado na LiveKit). */
export function useVoiceUsers(): Set<string> {
  const byTopic = usePresenceStore((s) => s.byTopic)
  const participants = useVoice((s) => s.participants)
  const status = useVoice((s) => s.status)
  useTick()
  const out = new Set<string>()
  for (const topic of Object.keys(byTopic)) if (topic.startsWith('srv:')) for (const [uid, m] of Object.entries(byTopic[topic])) if (m.voice && fresh(m)) out.add(uid)
  if (status === 'connected') for (const p of participants) out.add(p.identity)
  return out
}

export function useVoiceOccupants(): Record<string, string[]> {
  const byTopic = usePresenceStore((s) => s.byTopic)
  const myChannel = useVoice((s) => s.channelId)
  const participants = useVoice((s) => s.participants)
  const status = useVoice((s) => s.status)
  useTick()
  const out: Record<string, Set<string>> = {}
  for (const topic of Object.keys(byTopic)) {
    if (!topic.startsWith('srv:')) continue
    for (const [uid, m] of Object.entries(byTopic[topic])) {
      if (m.voice && fresh(m)) (out[m.voice] ??= new Set()).add(uid)
    }
  }
  // no canal em que EU estou, a LiveKit é a fonte da verdade (entra e sai na hora, sem depender da presença)
  if (myChannel && status === 'connected' && participants.length) out[myChannel] = new Set(participants.map((p) => p.identity))
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]))
}

const IDLE_MS = 5 * 60_000

/** Gerencia os canais de presença (servidores + amigos + próprio). Monte uma vez no AppShell. */
export function usePresenceManager() {
  const uid = useSession((s) => s.user?.id)
  const profile = useSession((s) => s.profile)
  const voiceChannel = useVoice((s) => s.channelId)
  const live = useVoice((s) => s.screenOn)
  const cam = useVoice((s) => s.camOn)
  const { data: servers } = useServers()
  const { data: friends } = useFriends()
  const { data: dms } = useDMs()
  const channels = useRef(new Map<string, { ch: RealtimeChannel; track: boolean }>())
  const [idle, setIdle] = useState(false)

  const pref = profile?.status_pref ?? 'online'
  const myStatus: Presence | null = pref === 'invisible' ? null : pref === 'online' && idle ? 'idle' : pref
  const meta = useRef<Meta | null>(null)
  meta.current = myStatus ? { status: myStatus, voice: voiceChannel, live: !!voiceChannel && live, cam: !!voiceChannel && cam, ts: Date.now() } : null

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
          const best = metas.slice().sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0) || RANK[b.status] - RANK[a.status])[0]
          if (best) flat[k] = { status: best.status, voice: best.voice ?? null, live: !!best.live, cam: !!best.cam, ts: best.ts }
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
  const metaKey = meta.current ? `${meta.current.status}|${meta.current.voice ?? ''}|${meta.current.live ? 1 : 0}|${meta.current.cam ? 1 : 0}` : 'off'
  useEffect(() => {
    for (const { ch, track } of channels.current.values()) {
      if (!track) continue
      if (meta.current) void ch.track(meta.current)
      else void ch.untrack()
    }
  }, [metaKey, wantedKey])

  // Batimento: renova o carimbo enquanto estou numa chamada; ao fechar a aba, tenta sair da presença na hora
  useEffect(() => {
    const beat = () => {
      if (!meta.current?.voice) return
      meta.current = { ...meta.current, ts: Date.now() }
      for (const { ch, track } of channels.current.values()) if (track) void ch.track(meta.current)
    }
    const iv = setInterval(beat, HEARTBEAT_MS)
    const bye = () => { for (const { ch, track } of channels.current.values()) if (track) void ch.untrack() }
    window.addEventListener('pagehide', bye)
    return () => {
      clearInterval(iv)
      window.removeEventListener('pagehide', bye)
    }
  }, [])

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

/** Canal de voz em que a pessoa está agora neste servidor (pela presença em tempo real), se houver. */
export function voiceChannelOf(userId: string, serverId: string): string | null {
  const m = usePresenceStore.getState().byTopic[`srv:${serverId}`]?.[userId]
  return fresh(m) ? (m?.voice ?? null) : null
}