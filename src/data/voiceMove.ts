import { useCallback, type DragEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { hasPerm, topPosition } from '@/lib/perms'
import { qk, useMembers, usePermCtx, useRoles } from '@/data/queries'
import { MUSIC_BOT_ID } from '@/data/music'
import { voiceChannelOf } from '@/data/presence'
import { voiceModerate } from '@/data/voiceModeration'
import { useSession } from '@/store/session'
import { toast } from '@/store/ui'
import type { Channel } from '@/lib/types'

interface DragState {
  drag: { userId: string; serverId: string } | null
  over: string | null
  set: (s: Partial<Pick<DragState, 'drag' | 'over'>>) => void
}
export const useMoveDrag = create<DragState>((set) => ({ drag: null, over: null, set: (s) => set(s) }))

/**
 * Arrastar um nome (lista de membros ou ocupantes de uma chamada) para outro canal de voz.
 * Só quem tem "Mover membros" (ou é o dono) e só para quem está numa chamada; o banco revalida tudo.
 */
export function useVoiceMove(serverId: string) {
  const me = useSession((s) => s.user?.id)
  const ctx = usePermCtx(serverId)
  const { data: members } = useMembers(serverId)
  const { data: roles } = useRoles(serverId)
  const qc = useQueryClient()
  const drag = useMoveDrag((s) => s.drag)
  const over = useMoveDrag((s) => s.over)
  const setDrag = useMoveDrag((s) => s.set)

  const canMoveUser = useCallback(
    (uid: string) => {
      if (!ctx || !members || !roles || uid === me || uid === MUSIC_BOT_ID || uid === ctx.server.owner_id) return false
      if (!hasPerm(ctx, 'move_members') || !voiceChannelOf(uid, serverId)) return false
      const member = members.find((m) => m.user_id === uid)
      if (!member) return false
      return topPosition(ctx) > topPosition({ server: ctx.server, roles, member }, uid)
    },
    [ctx, members, roles, me, serverId],
  )

  const dragProps = (uid: string) =>
    canMoveUser(uid)
      ? {
          draggable: true as const,
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', uid)
            setDrag({ drag: { userId: uid, serverId } })
          },
          onDragEnd: () => setDrag({ drag: null, over: null }),
        }
      : {}

  const dropProps = (ch: Channel) => {
    if (ch.kind !== 'voice' || !drag || drag.serverId !== serverId) return {}
    const from = voiceChannelOf(drag.userId, serverId)
    if (!from || from === ch.id) return {}
    return {
      onDragOver: (e: DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (over !== ch.id) setDrag({ over: ch.id })
      },
      onDragLeave: (e: DragEvent) => {
        if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null) && over === ch.id) setDrag({ over: null })
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        setDrag({ drag: null, over: null })
        voiceModerate({ serverId, targetId: drag.userId, action: 'move', channelId: from, destId: ch.id }).then(
          () => {
            toast.success(`Movido para ${ch.name}.`)
            void qc.invalidateQueries({ queryKey: qk.members(serverId) })
          },
          (err) => toast.error((err as Error).message),
        )
      },
    }
  }

  return { dragProps, dropProps, overId: over, dragging: !!drag }
}
