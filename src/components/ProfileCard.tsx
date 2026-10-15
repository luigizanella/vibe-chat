import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Crown, MessageSquare, UserMinus, UserPlus, Ban } from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { mediaUrl } from '@/lib/media'
import { useUI, toast } from '@/store/ui'
import { useSession } from '@/store/session'
import { qk, useFriends, useMembers, useProfile, useRoles, useServers } from '@/data/queries'
import { usePresenceOf } from '@/data/presence'
import { Avatar, PRESENCE_LABEL, Spinner } from '@/components/ui'

/** Cartão de perfil flutuante (popover). */
export function ProfileCardHost() {
  const card = useUI((s) => s.profileCard)
  const close = useUI((s) => s.closeProfile)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!card || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({
      x: Math.max(8, Math.min(card.x + 8, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(card.y, window.innerHeight - r.height - 8)),
    })
  }, [card])

  useEffect(() => {
    if (!card) return
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [card, close])

  if (!card) return null
  return (
    <div ref={ref} role="dialog" aria-label="Perfil do usuário" className="fixed w-[min(320px,92vw)] overflow-hidden rounded-xl border border-border bg-[var(--bg-elevated)] shadow-[var(--shadow)]" style={{ left: pos.x, top: pos.y, zIndex: 'var(--z-menu)' as unknown as number, animation: 'pop-in var(--dur-fast) var(--ease)' }}>
      <CardBody userId={card.userId} serverId={card.serverId} onClose={close} />
    </div>
  )
}

function CardBody({ userId, serverId, onClose }: { userId: string; serverId: string | null; onClose: () => void }) {
  const { data: p, isLoading } = useProfile(userId)
  const status = usePresenceOf(userId)
  const me = useSession((s) => s.user?.id)
  const { data: friends } = useFriends()
  const { data: servers } = useServers()
  const { data: members } = useMembers(serverId ?? undefined)
  const { data: roles } = useRoles(serverId ?? undefined)
  const nav = useNavigate()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>
  if (!p) return <div className="p-6 text-center text-fg-2">Perfil indisponível.</div>

  const member = members?.find((m) => m.user_id === userId)
  const isOwner = !!serverId && servers?.find((s) => s.id === serverId)?.owner_id === userId
  const userRoles = roles?.filter((r) => !r.is_default && member?.member_roles.some((mr) => mr.role_id === r.id)) ?? []
  const rel = friends?.find((f) => f.other.id === userId)
  const isMe = me === userId
  const banner = mediaUrl(p.banner_path)

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      if (ok) toast.success(ok)
      await qc.invalidateQueries({ queryKey: qk.friends })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="h-[72px]" style={{ background: banner ? `center/cover url(${banner})` : (p.banner_color ?? 'var(--accent)') }} />
      <div className="relative px-4 pb-4">
        <div className="-mt-10 mb-2 rounded-full ring-[5px] ring-[var(--bg-elevated)] w-fit"><Avatar path={p.avatar_path} name={p.display_name || p.username} id={p.id} size={76} status={status} ring="var(--bg-elevated)" /></div>
        <div className="flex items-center gap-1.5 text-lg font-bold">{member?.nickname || p.display_name || p.username}{isOwner && <Crown size={15} className="text-warning" aria-label="Dono do servidor" />}</div>
        <div className="text-fg-2">@{p.username} • {PRESENCE_LABEL[status]}</div>
        {p.custom_status && <div className="mt-1">{p.custom_status}</div>}
        {p.bio && (<><div className="label mt-3 mb-1">Sobre mim</div><div className="whitespace-pre-wrap text-fg-2">{p.bio}</div></>)}
        {userRoles.length > 0 && (<><div className="label mt-3 mb-1">Cargos</div><div className="flex flex-wrap gap-1">{userRoles.map((r) => <span key={r.id} className="rounded-full px-2 py-0.5 text-xs" style={{ background: `${r.color}33`, color: r.color }}>{r.name}</span>)}</div></>)}
        <div className="label mt-3 mb-1">Na plataforma desde</div>
        <div className="flex items-center gap-1 text-fg-2">{formatDate(p.created_at)}</div>
        {!isMe && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(async () => { const id = await rpc<string>('open_dm', { p_user: userId }); await qc.invalidateQueries({ queryKey: qk.dms }); onClose(); nav(`/app/@me/${id}`) })}><MessageSquare size={14} /> Mensagem</button>
            {!rel && <button className="btn btn-sm" disabled={busy} onClick={() => act(() => rpc('send_friend_request', { p_username: p.username }), 'Pedido de amizade enviado.')}><UserPlus size={14} /> Adicionar</button>}
            {rel?.status === 'incoming' && <button className="btn btn-sm" disabled={busy} onClick={() => act(() => rpc('respond_friend_request', { p_requester: userId, p_accept: true }), 'Amizade aceita.')}><UserPlus size={14} /> Aceitar</button>}
            {rel?.status === 'outgoing' && <button className="btn btn-sm" disabled={busy} onClick={() => act(() => rpc('remove_friend', { p_user: userId }), 'Pedido cancelado.')}>Cancelar pedido</button>}
            {rel?.status === 'friend' && <button className="btn btn-sm" disabled={busy} onClick={() => act(() => rpc('remove_friend', { p_user: userId }), 'Amizade desfeita.')}><UserMinus size={14} /> Desfazer</button>}
            <button className="btn btn-sm btn-ghost text-danger" disabled={busy} onClick={() => act(async () => { await rpc('block_user', { p_user: userId }); await qc.invalidateQueries({ queryKey: qk.blocks }); onClose() }, 'Usuário bloqueado.')}><Ban size={14} /> Bloquear</button>
          </div>
        )}
      </div>
    </div>
  )
}
