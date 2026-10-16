import { useQuery } from '@tanstack/react-query'
import { rpc, supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import type { MusicQueueItem, MusicSession } from '@/lib/types'
import { fetchTitle, findYouTubeId, parseMusicCommand, parseYouTubeId, type MusicCommand } from '@/lib/youtube'
import { toast } from '@/store/ui'
import { useVoice } from '@/store/voice'

export interface MusicState {
  session: MusicSession | null
  queue: MusicQueueItem[]
}

export const musicKey = (channelId: string) => ['music', 'channel', channelId] as const
export const serverMusicKey = (serverId: string) => ['music', 'server', serverId] as const

export function useMusic(channelId: string | null | undefined) {
  return useQuery({
    queryKey: musicKey(channelId ?? ''),
    enabled: !!channelId,
    staleTime: 10_000,
    queryFn: async (): Promise<MusicState> => {
      const [s, q] = await Promise.all([
        supabase.from('music_sessions').select('*').eq('channel_id', channelId!).maybeSingle(),
        supabase.from('music_queue').select('*').eq('channel_id', channelId!).order('ord'),
      ])
      if (s.error) throw s.error
      if (q.error) throw q.error
      return { session: (s.data as MusicSession | null) ?? null, queue: (q.data ?? []) as MusicQueueItem[] }
    },
  })
}

/** Sessões de música do servidor (para mostrar o bot nos canais de voz que têm música tocando). */
/** Perfil fixo do bot de música (criado pela migração). */
export const MUSIC_BOT_ID = '00000000-0000-4000-8000-00000000b075'

export function useServerMusic(serverId: string | undefined) {
  return useQuery({
    queryKey: serverMusicKey(serverId ?? ''),
    enabled: !!serverId,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('music_sessions').select('*').eq('server_id', serverId!)
      if (error) throw error
      return (data ?? []) as MusicSession[]
    },
  })
}

// ---- relógio: diferença entre o horário do servidor e o do dispositivo (para sincronizar a posição) ----
let clockOffset = 0
let clockReadyAt = 0
export async function syncClock(): Promise<number> {
  if (Date.now() - clockReadyAt < 5 * 60_000) return clockOffset
  try {
    const t0 = Date.now()
    const iso = await rpc<string>('server_now')
    const t1 = Date.now()
    clockOffset = new Date(iso).getTime() - (t0 + t1) / 2
    clockReadyAt = Date.now()
  } catch {
    /* mantém o último valor */
  }
  return clockOffset
}
export const serverNow = () => Date.now() + clockOffset

/** Posição atual (ms) da faixa, segundo o estado compartilhado. */
export function positionMs(s: MusicSession | null): number {
  if (!s || s.status === 'idle') return 0
  if (s.status === 'paused') return s.paused_ms
  return Math.max(0, serverNow() - new Date(s.started_at ?? Date.now()).getTime())
}

// ---------------------------------------------------------------- ações ---
export async function addMusic(channelId: string, input: string): Promise<string | null> {
  const id = parseYouTubeId(input) ?? findYouTubeId(input)
  if (!id) {
    toast.error('Cole um link válido de vídeo do YouTube (youtube.com/watch…, youtu.be/…).')
    return null
  }
  const title = await fetchTitle(id)
  try {
    await rpc('music_add', { p_channel: channelId, p_video: id, p_title: title })
    return title
  } catch (e) {
    toast.error(musicError(e))
    return null
  }
}

export async function controlMusic(channelId: string, action: 'pause' | 'resume' | 'skip' | 'back' | 'stop', expect?: string | null) {
  try {
    await rpc('music_control', { p_channel: channelId, p_action: action, p_expect: expect ?? null })
  } catch (e) {
    toast.error(musicError(e))
  }
}

export async function removeFromQueue(channelId: string, queueId: number) {
  try {
    await rpc('music_remove', { p_channel: channelId, p_queue_id: queueId })
  } catch (e) {
    toast.error(musicError(e))
  }
}

export function musicError(e: unknown): string {
  const m = errorMessage(e)
  if (/bot_disabled/.test(String((e as { message?: string })?.message))) return 'O bot Vibe Beats está desligado neste servidor. Peça a quem administra para ligá-lo em Configurações do servidor → Música.'
  if (/limit_reached/.test(String((e as { message?: string })?.message))) return 'A fila está cheia (máximo de 50 músicas).'
  return m
}

export const MUSIC_HELP =
  'Comandos: /tocar <link do YouTube> · /pular · /pausar · /continuar · /voltar · /fila · /parar. Você precisa estar em um canal de voz.'

/** Executa um comando de música no canal de voz em que a pessoa está. Retorna true se tratou o texto. */
export async function runMusicCommand(cmd: MusicCommand): Promise<void> {
  if (cmd.name === 'ajuda') return void toast.info(MUSIC_HELP)
  const ch = useVoice.getState().channelId
  if (!ch) return void toast.error('Entre em um canal de voz para usar os comandos de música.')
  if (cmd.name === 'tocar') {
    if (!cmd.arg) return void toast.info('Use: /tocar <link do YouTube>')
    const title = await addMusic(ch, cmd.arg)
    if (title) toast.success(`Adicionada: ${title}`)
  } else if (cmd.name === 'fila') {
    const [s, q] = await Promise.all([
      supabase.from('music_sessions').select('title').eq('channel_id', ch).maybeSingle(),
      supabase.from('music_queue').select('title').eq('channel_id', ch).order('ord').limit(5),
    ])
    const title = (s.data as { title?: string } | null)?.title
    const lines = [title ? `Agora: ${title}` : 'Nada tocando', ...((q.data ?? []) as { title: string }[]).map((x, i) => `${i + 1}. ${x.title}`)]
    toast.info(lines.join(' · '))  } else {
    const action = { pular: 'skip', pausar: 'pause', continuar: 'resume', voltar: 'back', parar: 'stop' }[cmd.name] as 'skip' | 'pause' | 'resume' | 'back' | 'stop'
    await controlMusic(ch, action)
  }
}

export { parseMusicCommand }
