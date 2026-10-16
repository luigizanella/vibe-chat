import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { rpc } from '@/lib/supabase'
import { hasPerm, highestRole } from '@/lib/perms'
import { useReadable } from '@/lib/useReadable'
import { useBlocks, useMembers, usePermCtx, useRoles } from '@/data/queries'
import type { DmConversation } from '@/lib/types'
import { useSession } from '@/store/session'
import type { ChatCtx, Mentionable } from './chatContext'

export function useServerChatCtx(serverId: string, channelId: string): ChatCtx {
  const me = useSession((s) => s.user?.id)
  const [, setTick] = useState(0)
  const { data: members } = useMembers(serverId)
  const { data: roles } = useRoles(serverId)
  const ctx = usePermCtx(serverId)
  const readable = useReadable('primary')
  const { data: canSendHere } = useQuery({
    queryKey: ['cansend', channelId],
    queryFn: async () => (await rpc<boolean>('can_send_in_channel', { p_channel: channelId })) === true,
  })

  // quando o castigo termina, reavalia a permissão de escrever sem precisar recarregar
  const myTimeout = members?.find((m) => m.user_id === me)?.timeout_until
  useEffect(() => {
    if (!myTimeout) return
    const ms = new Date(myTimeout).getTime() - Date.now()
    if (ms <= 0) return
    const t = setTimeout(() => setTick((n) => n + 1), Math.min(ms + 300, 2_000_000_000))
    return () => clearTimeout(t)
  }, [myTimeout])

  return useMemo<ChatCtx>(() => {
    const byId = new Map(members?.map((m) => [m.user_id, m]))
    const roleById = new Map(roles?.map((r) => [r.id, r]))
    const nameOf = (id: string | null | undefined) => {
      if (!id) return 'Usuário excluído'
      const m = byId.get(id)
      return m?.nickname || m?.profile?.display_name || m?.profile?.username || 'Ex-membro'
    }
    const mentionables: Mentionable[] = [
      ...(members ?? []).map((m) => ({ id: m.user_id, kind: 'user' as const, name: m.nickname || m.profile?.display_name || m.profile?.username || '?', username: m.profile?.username, avatar_path: m.profile?.avatar_path })),
      ...(roles ?? []).filter((r) => !r.is_default).map((r) => ({ id: r.id, kind: 'role' as const, name: r.name, color: r.color })),
    ]
    const meMember = members?.find((m) => m.user_id === me)
    const timeoutUntil = meMember?.timeout_until && new Date(meMember.timeout_until) > new Date() ? new Date(meMember.timeout_until) : null
    const canSend = (canSendHere ?? false) && !timeoutUntil
    return {
      scope: { kind: 'channel', id: channelId },
      serverId,
      resolver: {
        user: (id) => (byId.has(id) ? { name: nameOf(id) } : null),
        role: (id) => roleById.get(id) ?? null,
      },
      mentionables,
      nameOf,
      colorOf: (id) => {
        const m = id ? byId.get(id) : undefined
        return m && roles ? readable(highestRole(roles, m)?.color) : undefined
      },
      canSend,
      canAttach: canSend && hasPerm(ctx, 'attach_files'),
      canReact: hasPerm(ctx, 'add_reactions') && !timeoutUntil,
      canManageMessages: hasPerm(ctx, 'manage_messages'),
      blockedReason: timeoutUntil ? `Você está de castigo até ${timeoutUntil.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} e não pode enviar mensagens.` : 'Você não tem permissão para enviar mensagens neste canal.',
    }
  }, [members, roles, ctx, canSendHere, channelId, serverId, readable, me])
}

export function useDmChatCtx(dm: DmConversation | undefined, dmId: string): ChatCtx {
  const me = useSession((s) => s.user?.id)
  const { data: blocked } = useBlocks()
  return useMemo<ChatCtx>(() => {
    const people = new Map((dm?.dm_participants ?? []).map((p) => [p.user_id, p.profile]))
    const nameOf = (id: string | null | undefined) => {
      if (!id) return 'Usuário excluído'
      const p = people.get(id)
      return p?.display_name || p?.username || 'Usuário'
    }
    const other = !dm?.is_group ? dm?.dm_participants.find((p) => p.user_id !== me)?.user_id : undefined
    const isBlocked = !!other && !!blocked?.some((b) => b.id === other)
    return {
      scope: { kind: 'dm', id: dmId },
      serverId: null,
      resolver: { user: (id) => (people.has(id) ? { name: nameOf(id) } : null), role: () => null },
      mentionables: dm?.is_group ? [...people.entries()].filter(([id]) => id !== me).map(([id, p]) => ({ id, kind: 'user' as const, name: p?.display_name || p?.username || '?', username: p?.username, avatar_path: p?.avatar_path })) : [],
      nameOf,
      colorOf: () => undefined,
      canSend: !isBlocked,
      canAttach: !isBlocked,
      canReact: true,
      canManageMessages: false,
      blockedReason: 'Você bloqueou este usuário. Desbloqueie para enviar mensagens.',
    }
  }, [dm, dmId, me, blocked])
}
