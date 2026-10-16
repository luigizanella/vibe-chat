import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/store/session'
import { expectModeratorMove, useVoice } from '@/store/voice'
import { toast } from '@/store/ui'
import { qk, useMembers } from './queries'
import type { Channel } from '@/lib/types'

/**
 * Moderação de voz no cliente:
 *  - recebe comandos privados (mover/desconectar) enviados pelo servidor no tópico cmd:<uid>;
 *  - espelha no cliente o silenciamento/ensurdecimento aplicado por moderadores (o efeito real é
 *    garantido no LiveKit pela Edge Function; isto só mantém a interface coerente).
 */
export function useVoiceModeration() {
  const uid = useSession((s) => s.user?.id)
  const qc = useQueryClient()
  const nav = useNavigate()
  const serverId = useVoice((s) => s.target?.serverId)
  const { data: members } = useMembers(serverId)

  useEffect(() => {
    if (!uid) return
    const ch = supabase.channel(`cmd:${uid}`, { config: { private: true } })
    ch.on('broadcast', { event: 'move' }, ({ payload }) => {
      const p = payload as { server_id: string; channel_id: string }
      expectModeratorMove()
      const channels = qc.getQueryData<Channel[]>(qk.channels(p.server_id)) ?? []
      const dest = channels.find((c) => c.id === p.channel_id)
      toast.info(`Um moderador moveu você para ${dest?.name ?? 'outro canal de voz'}.`)
      void useVoice.getState().join({ id: p.channel_id, serverId: p.server_id, name: dest?.name ?? 'Voz' })
      nav(`/app/s/${p.server_id}/${p.channel_id}`)
    })
    ch.on('broadcast', { event: 'disconnect' }, () => {
      toast.info('Um moderador desconectou você da chamada.')
      void useVoice.getState().leave()
    })
    ch.subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [uid, qc, nav])

  useEffect(() => {
    const me = members?.find((m) => m.user_id === uid)
    if (me) useVoice.getState().setServerFlags(!!me.voice_muted, !!me.voice_deafened)
  }, [members, uid])
}

export type VoiceAction = 'mute' | 'unmute' | 'deafen' | 'undeafen' | 'disconnect' | 'move'

/** Chama a Edge Function de moderação de voz. Lança Error com mensagem compreensível. */
export async function voiceModerate(args: { serverId: string; targetId: string; action: VoiceAction; channelId?: string | null; destId?: string | null }): Promise<void> {
  const { error } = await supabase.functions.invoke('voice-moderate', { body: { ...args, channelId: args.channelId ?? null, destId: args.destId ?? null } })
  if (!error) return
  let code = ''
  try {
    code = ((await (error as unknown as { context?: Response }).context?.json()) as { error?: string } | undefined)?.error ?? ''
  } catch {
    /* corpo ilegível */
  }
  if (code === 'forbidden') throw new Error('Você não tem permissão para fazer isso com essa pessoa (cargo igual ou superior, ou permissão ausente).')
  if (code === 'rate_limited') throw new Error('Muitas ações de moderação em pouco tempo. Aguarde um instante.')
  if (code === 'invalid_input') throw new Error('Ação inválida (verifique o canal de destino).')
  if (code === 'livekit_not_configured') throw new Error('O servidor de voz (LiveKit) não está configurado.')
  throw new Error('Não foi possível aplicar a ação de moderação agora.')
}