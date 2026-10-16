import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { idleSeconds, startIdleTracking, useAfk } from '@/lib/idle'
import { qk, useServers } from '@/data/queries'
import { useSettings } from '@/store/settings'
import { useVoice } from '@/store/voice'
import { toast } from '@/store/ui'
import type { Channel } from '@/lib/types'

interface Prev { serverId: string; id: string; name: string; micMuted: boolean; deafened: boolean }

/**
 * Ausência automática:
 *  - ocioso por X minutos (config. do servidor; 5 por padrão): status Ausente;
 *  - se estiver numa chamada de um servidor com canal de ausentes: muda para ele (mudo) e guarda de onde veio;
 *  - ao voltar a usar o computador: retorna ao canal anterior com o mesmo estado de mudo.
 */
export function useAfkWatcher() {
  const qc = useQueryClient()
  const { data: servers } = useServers()

  useEffect(() => {
    startIdleTracking()
    let moved: Prev | null = null
    let busy = false
    let stopped = false

    const tick = async () => {
      if (busy || stopped) return
      busy = true
      try {
        const v = useVoice.getState()
        const server = servers?.find((s) => s.id === v.target?.serverId)
        const afkId = server?.afk_channel_id ?? null
        if (v.afkChannelId !== afkId) useVoice.setState({ afkChannelId: afkId })

        let idle = await idleSeconds()
        // falar, transmitir ou assistir conta como atividade (não expulsa no meio de uma conversa)
        const counts = useSettings.getState().settings.afk.voiceCounts
        if (v.status === 'connected' && v.channelId !== afkId && ((counts && v.micOpen && !v.micMuted) || v.screenOn || v.camOn || v.watching)) idle = 0
        const timeout = (server?.afk_timeout_minutes ?? 5) * 60
        const afk = useAfk.getState()

        if (!afk.active && idle >= timeout) {
          useAfk.setState({ active: true })
          if (server && afkId && v.status === 'connected' && v.channelId && v.channelId !== afkId && v.target) {
            const chans = qc.getQueryData<Channel[]>(qk.channels(server.id)) ?? []
            const dest = chans.find((c) => c.id === afkId)
            if (dest) {
              moved = { serverId: server.id, id: v.channelId, name: v.target.name, micMuted: v.micMuted, deafened: v.deafened }
              toast.info(`Você foi movido para ${dest.name} por inatividade.`)
              await v.join({ id: dest.id, serverId: server.id, name: dest.name }, undefined, { muted: true })
            }
          }
        } else if (afk.active && idle < 3) {
          useAfk.setState({ active: false })
          const p = moved
          moved = null
          const now = useVoice.getState()
          if (p && now.channelId === afkId) {
            const ch = qc.getQueryData<Channel[]>(qk.channels(p.serverId))?.find((c) => c.id === p.id)
            if (ch) {
              await now.join({ id: ch.id, serverId: p.serverId, name: ch.name }, undefined, { muted: p.micMuted })
              if (p.deafened) await useVoice.getState().toggleDeafen()
              toast.info(`Você voltou para ${ch.name}.`)
            } else {
              await now.leave()
            }
          }
        } else if (moved && useVoice.getState().channelId !== afkId) {
          moved = null // a pessoa foi para outro canal por conta própria: sem retorno automático
        }
      } finally {
        busy = false
      }
    }

    const iv = setInterval(() => void tick(), 3000)
    return () => {
      stopped = true
      clearInterval(iv)
    }
  }, [servers, qc])
}
