import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Ban, Clock, Copy, Gavel, Hash, LogOut as DisconnectIcon, MicOff, MessageSquare, MoveRight, Pencil, Shield, User as UserIcon,
  UserMinus, UserPlus, UserX, Volume2, VolumeX,
} from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { hasPerm, topPosition } from '@/lib/perms'
import { qk, useFriends, useMembers, usePermCtx, useRoles } from '@/data/queries'
import { useSession } from '@/store/session'
import { useSettings } from '@/store/settings'
import { useUI, toast, type MenuItem } from '@/store/ui'
import { useVoice } from '@/store/voice'
import { Modal, Spinner, useCloseModal } from '@/components/ui'
import { TimeoutModal } from '@/components/modals/TimeoutModal'
import { voiceModerate, type VoiceAction } from '@/data/voiceModeration'
import { voiceChannelOf } from '@/data/presence'
import type { Channel } from '@/lib/types'

const MUSIC_BOT_ID = '00000000-0000-4000-8000-00000000b075'

/** Apelido local (só você vê) ou, se não houver, o nome informado. */
export function useLocalNick() {
  const nicks = useSettings((s) => s.settings.nicknames)
  return useCallback((userId: string, fallback: string) => nicks[userId] || fallback, [nicks])
}

export function NicknameModal({ userId, serverId, isSelf, current, name }: { userId: string; serverId: string | null; isSelf: boolean; current: string; name: string }) {
  const close = useCloseModal()
  const update = useSettings((s) => s.update)
  const qc = useQueryClient()
  const [text, setText] = useState(current)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      if (isSelf && serverId) {
        await rpc('set_nickname', { p_server: serverId, p_nickname: text })
        await qc.invalidateQueries({ queryKey: qk.members(serverId) })
      } else {
        const next = { ...useSettings.getState().settings.nicknames }
        if (text.trim()) next[userId] = text.trim().slice(0, 32)
        else delete next[userId]
        update({ nicknames: next })
      }
      close()
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isSelf ? 'Alterar apelido no servidor' : `Apelido para ${name}`}
      description={isSelf ? 'Todos no servidor verão este apelido.' : 'Só você vê este apelido. Deixe vazio para remover.'}
      footer={<><button className="btn btn-ghost" onClick={close}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy && <Spinner size={14} />} Salvar</button></>}
    >
      <div className="field"><label htmlFor="nick">Apelido</label>
        <input id="nick" className="input" value={text} maxLength={32} autoFocus onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} /></div>
    </Modal>
  )
}

/**
 * Menu de contexto de um usuário (call, lista de membros, mensagens).
 * Itens de moderação só são habilitados quando as permissões/hierarquia permitem; a validação real é no banco.
 */
export function useUserMenu(serverId: string | null) {
  const me = useSession((s) => s.user?.id ?? '')
  const nav = useNavigate()
  const qc = useQueryClient()
  const ctx = usePermCtx(serverId ?? undefined)
  const { data: members } = useMembers(serverId ?? undefined)
  const { data: roles } = useRoles(serverId ?? undefined)
  const { data: friends } = useFriends()
  const nicks = useSettings((s) => s.settings.nicknames)
  const openMenu = useUI((s) => s.openMenu)
  const openProfile = useUI((s) => s.openProfile)
  const openModal = useUI((s) => s.openModal)
  const voiceRoom = useVoice((s) => s.room)
  const volumes = useVoice((s) => s.volumes)
  const setVolume = useVoice((s) => s.setVolume)
  const voiceParticipants = useVoice((s) => s.participants)

  return useCallback(
    (userId: string, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const member = members?.find((m) => m.user_id === userId)
      const profile = member?.profile
      const name = nicks[userId] || member?.nickname || profile?.display_name || profile?.username || 'usuário'
      const username = profile?.username ?? ''
      const isSelf = userId === me
      const rel = friends?.find((f) => f.other.id === userId)
      const items: MenuItem[] = []

      items.push({ label: 'Ver perfil completo', icon: <UserIcon size={16} />, onClick: () => openProfile(userId, serverId, e.clientX, e.clientY) })
      if (!isSelf) {
        items.push({
          label: 'Mensagem',
          icon: <MessageSquare size={16} />,
          onClick: () =>
            rpc<string>('open_dm', { p_user: userId }).then(
              (id) => { void qc.invalidateQueries({ queryKey: qk.dms }); nav(`/app/@me/${id}`) },
              (err) => toast.error(errorMessage(err)),
            ),
        })
      }

      // volume: só para quem está na mesma chamada que você
      const inCall = !!voiceRoom && !isSelf && voiceParticipants.some((p) => p.identity === userId && !p.isLocal)
      if (inCall) {
        items.push({ separator: true }, { kind: 'slider', label: 'Volume do usuário', value: volumes[userId] ?? 1, min: 0, max: 1, step: 0.01, onChange: (v) => setVolume(userId, v) })
      }

      items.push({ separator: true }, {
        label: isSelf ? 'Alterar apelido no servidor' : 'Editar apelido',
        icon: <Pencil size={16} />,
        disabled: isSelf && !serverId,
        tip: 'Disponível apenas dentro de um servidor.',
        onClick: () => openModal(<NicknameModal userId={userId} serverId={serverId} isSelf={isSelf} name={name} current={isSelf ? (member?.nickname ?? '') : (nicks[userId] ?? '')} />),
      })

      if (!isSelf) {
        if (rel?.status === 'friend')
          items.push({ label: 'Desfazer amizade', icon: <UserMinus size={16} />, danger: true, onClick: () => rpc('remove_friend', { p_user: userId }).then(() => qc.invalidateQueries({ queryKey: qk.friends }), (err) => toast.error(errorMessage(err))) })
        else if (!rel)
          items.push({ label: 'Adicionar amigo', icon: <UserPlus size={16} />, disabled: !username, onClick: () => rpc('send_friend_request', { p_username: username }).then(() => { toast.success('Pedido de amizade enviado.'); void qc.invalidateQueries({ queryKey: qk.friends }) }, (err) => toast.error(errorMessage(err))) })
        else if (rel.status === 'outgoing')
          items.push({ label: 'Cancelar pedido de amizade', icon: <UserMinus size={16} />, onClick: () => rpc('remove_friend', { p_user: userId }).then(() => qc.invalidateQueries({ queryKey: qk.friends }), (err) => toast.error(errorMessage(err))) })
        else
          items.push({ label: 'Aceitar pedido de amizade', icon: <UserPlus size={16} />, onClick: () => rpc('respond_friend_request', { p_requester: userId, p_accept: true }).then(() => qc.invalidateQueries({ queryKey: qk.friends }), (err) => toast.error(errorMessage(err))) })
        items.push({ label: 'Bloquear', icon: <Ban size={16} />, danger: true, onClick: () => rpc('block_user', { p_user: userId }).then(() => { toast.success('Usuário bloqueado.'); void qc.invalidateQueries({ queryKey: qk.blocks }); void qc.invalidateQueries({ queryKey: qk.friends }) }, (err) => toast.error(errorMessage(err))) })
      }

      // --- ações de servidor ---
      if (serverId && ctx && member && roles) {
        const targetIsOwner = ctx.server.owner_id === userId
        const myTop = topPosition(ctx)
        const theirTop = topPosition({ server: ctx.server, roles, member }, userId)
        const outranks = !isSelf && !targetIsOwner && myTop > theirTop
        const iAmOwner = ctx.server.owner_id === me
        const canRoles = iAmOwner || (hasPerm(ctx, 'manage_roles') && (outranks || isSelf))
        const assignable = roles.filter((r) => !r.is_default)

        items.push({ separator: true }, {
          label: 'Cargos',
          icon: <Shield size={16} />,
          disabled: !canRoles || !assignable.length,
          tip: !assignable.length ? 'Este servidor não tem cargos.' : 'Você não pode gerenciar os cargos desta pessoa.',
          children: assignable.map<MenuItem>((r) => ({
            kind: 'checkbox',
            label: r.name,
            checked: member.member_roles.some((mr) => mr.role_id === r.id),
            disabled: !iAmOwner && r.position >= myTop,
            tip: 'Cargo acima do seu nível.',
            onToggle: (checked) =>
              rpc('set_member_role', { p_server: serverId, p_user: userId, p_role: r.id, p_grant: checked }).then(
                () => qc.invalidateQueries({ queryKey: qk.members(serverId) }),
                (err) => { toast.error(errorMessage(err)); void qc.invalidateQueries({ queryKey: qk.members(serverId) }) },
              ),
          })),
        })

        if (!isSelf && !targetIsOwner && member.user_id !== MUSIC_BOT_ID) {
          const inVoice = voiceChannelOf(userId, serverId)
          const run = (action: VoiceAction, destId?: string) =>
            voiceModerate({ serverId, targetId: userId, action, channelId: inVoice, destId: destId ?? null }).then(
              () => qc.invalidateQueries({ queryKey: qk.members(serverId) }),
              (err) => { toast.error((err as Error).message); void qc.invalidateQueries({ queryKey: qk.members(serverId) }) },
            )
          const can = (perm: string) => hasPerm(ctx, perm) && outranks
          const voiceChannels = (qc.getQueryData<Channel[]>(qk.channels(serverId)) ?? []).filter((c) => c.kind === 'voice' && c.id !== inVoice)
          items.push(
            {
              label: 'Mover para…',
              icon: <MoveRight size={16} />,
              disabled: !can('move_members') || !inVoice || !voiceChannels.length,
              tip: !can('move_members') ? 'Sem permissão para mover membros (ou cargo igual/superior).' : !inVoice ? 'Esta pessoa não está em uma chamada.' : 'Não há outro canal de voz.',
              children: voiceChannels.map<MenuItem>((c) => ({ label: c.name, icon: <Volume2 size={14} />, onClick: () => void run('move', c.id) })),
            },
            { kind: 'checkbox', label: 'Silenciar voz no servidor', icon: <MicOff size={16} />, danger: true, checked: !!member.voice_muted, disabled: !can('mute_members'), tip: 'Sem permissão para silenciar (ou cargo igual/superior).', onToggle: (v) => void run(v ? 'mute' : 'unmute') },
            { kind: 'checkbox', label: 'Desativar áudio no servidor', icon: <VolumeX size={16} />, danger: true, checked: !!member.voice_deafened, disabled: !can('deafen_members'), tip: 'Sem permissão para ensurdecer (ou cargo igual/superior).', onToggle: (v) => void run(v ? 'deafen' : 'undeafen') },
            { label: 'Desconectar', icon: <DisconnectIcon size={16} />, danger: true, disabled: !can('move_members') || !inVoice, tip: !inVoice ? 'Esta pessoa não está em uma chamada.' : 'Sem permissão para desconectar membros (ou cargo igual/superior).', onClick: () => void run('disconnect') },
          )
        }        if (!isSelf && !profile?.is_bot) {
          const canKick = hasPerm(ctx, 'kick_members') && outranks
          const canBan = hasPerm(ctx, 'ban_members') && outranks
          items.push(
            { label: member.timeout_until && new Date(member.timeout_until) > new Date() ? `Editar castigo de ${name}` : `Castigar ${name}`, icon: <Clock size={16} />, danger: true, disabled: !(hasPerm(ctx, 'moderate_members') && outranks), tip: 'Sem permissão para castigar (ou cargo igual/superior).', onClick: () => openModal(<TimeoutModal serverId={serverId} userId={userId} name={name} active={!!member.timeout_until && new Date(member.timeout_until) > new Date()} />) },
            { label: `Expulsar ${name}`, icon: <UserX size={16} />, danger: true, disabled: !canKick, tip: 'Sem permissão ou cargo igual/superior.', onClick: () => import('@/components/modals/MemberActions').then((m) => m.askReason(`Expulsar ${name}`, 'Expulsar', async (reason) => { await rpc('kick_member', { p_server: serverId, p_user: userId, p_reason: reason }); await qc.invalidateQueries({ queryKey: qk.members(serverId) }); toast.success('Membro expulso.') })) },
            { label: `Banir ${name}`, icon: <Gavel size={16} />, danger: true, disabled: !canBan, tip: 'Sem permissão ou cargo igual/superior.', onClick: () => import('@/components/modals/MemberActions').then((m) => m.askReason(`Banir ${name}`, 'Banir', async (reason) => { await rpc('ban_member', { p_server: serverId, p_user: userId, p_reason: reason }); await qc.invalidateQueries({ queryKey: qk.members(serverId) }); toast.success('Membro banido.') })) },
          )
        }
      }

      items.push(
        { separator: true },
        { label: 'Copiar nome de usuário', icon: <Copy size={16} />, disabled: !username, onClick: () => void navigator.clipboard.writeText(username).then(() => toast.success('Nome de usuário copiado.')) },
        { label: 'Copiar ID do usuário', icon: <Hash size={16} />, onClick: () => void navigator.clipboard.writeText(userId).then(() => toast.success('ID copiado.')) },
      )
      openMenu(e.clientX, e.clientY, items)
    },
    [members, roles, ctx, friends, nicks, me, serverId, nav, qc, openMenu, openProfile, openModal, voiceRoom, volumes, setVolume, voiceParticipants],
  )
}
