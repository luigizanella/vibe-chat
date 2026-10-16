import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, MoreHorizontal, SendHorizontal } from 'lucide-react'
import { rpc, supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { mediaUrl } from '@/lib/media'
import { useUI, toast } from '@/store/ui'
import { useSession } from '@/store/session'
import { qk, useMembers, useProfile, useRoles, useServers } from '@/data/queries'
import { sendMessage } from '@/data/messages'
import { usePresenceOf } from '@/data/presence'
import { Avatar, PRESENCE_LABEL, Spinner } from '@/components/ui'
import { useLocalNick, useUserMenu } from '@/components/userMenu'
import { Linkified } from '@/components/Linkified'

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
    <div
      ref={ref}
      role="dialog"
      aria-label="Perfil do usuário"
      className="fixed w-[min(340px,94vw)] overflow-hidden rounded-lg border border-border bg-[var(--bg-tertiary)] text-fg shadow-[var(--shadow)]"
      style={{ left: pos.x, top: pos.y, zIndex: 'var(--z-menu)' as unknown as number, animation: 'pop-in var(--dur-fast) var(--ease)' }}
    >
      <CardBody userId={card.userId} serverId={card.serverId} onClose={close} />
    </div>
  )
}

function CardBody({ userId, serverId, onClose }: { userId: string; serverId: string | null; onClose: () => void }) {
  const { data: p, isLoading } = useProfile(userId)
  const status = usePresenceOf(userId)
  const me = useSession((s) => s.user?.id)
  const { data: servers } = useServers()
  const { data: members } = useMembers(serverId ?? undefined)
  const { data: roles } = useRoles(serverId ?? undefined)
  const nav = useNavigate()
  const qc = useQueryClient()
  const localNick = useLocalNick()
  const userMenu = useUserMenu(serverId)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: mutualIds } = useQuery({
    queryKey: ['mutual', userId],
    enabled: !!userId && userId !== me,
    queryFn: async () => {
      const { data } = await supabase.from('members').select('server_id').eq('user_id', userId)
      return (data ?? []).map((r: { server_id: string }) => r.server_id)
    },
  })

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>
  if (!p) return <div className="p-6 text-center text-fg-2">Perfil indisponível.</div>

  const member = members?.find((m) => m.user_id === userId)
  const isOwner = !!serverId && servers?.find((s) => s.id === serverId)?.owner_id === userId
  const userRoles = roles?.filter((r) => !r.is_default && member?.member_roles.some((mr) => mr.role_id === r.id)) ?? []
  const isMe = me === userId
  const banner = mediaUrl(p.banner_path)
  const shownName = localNick(userId, member?.nickname || p.display_name || p.username)
  const mutual = isMe ? [] : (servers ?? []).filter((s) => mutualIds?.includes(s.id))

  const send = async () => {
    const content = text.trim()
    if (!content || busy) return
    setBusy(true)
    try {
      const id = await rpc<string>('open_dm', { p_user: userId })
      await qc.invalidateQueries({ queryKey: qk.dms })
      onClose()
      nav(`/app/@me/${id}`)
      await sendMessage(qc, { scope: { kind: 'dm', id }, content })
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="relative h-[84px]" style={{ background: banner ? `center/cover url(${banner})` : (p.banner_color ?? 'var(--accent)') }}>
        <button
          className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full border-0 bg-black/55 text-white hover:bg-black/75"
          aria-label="Mais ações"
          data-tip="Mais ações"
          onClick={(e) => userMenu(userId, e)}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
      <div className="relative px-4 pb-4">
        <div className="-mt-11 mb-2 w-fit rounded-full ring-[6px] ring-[var(--bg-tertiary)]">
          <Avatar path={p.avatar_path} name={p.display_name || p.username} id={p.id} size={80} status={status} ring="var(--bg-tertiary)" />
        </div>
        <div className="rounded-lg bg-[var(--bg-primary)] p-3">
          <div className="flex items-center gap-1.5 text-xl font-bold">
            {shownName}
            {isOwner && <Crown size={16} className="text-warning" aria-label="Dono do servidor" />}
          </div>
          <div className="text-fg-2">{p.username} · {PRESENCE_LABEL[status]}</div>
          {p.custom_status && <div className="mt-1 text-sm">{p.custom_status}</div>}

          <div className="my-3 h-px bg-[var(--border)]" />
          {p.bio && (
            <>
              <div className="label mb-1">Sobre mim</div>
              <div className="mb-3 text-sm break-words whitespace-pre-wrap text-fg-2"><Linkified text={p.bio} /></div>
            </>
          )}
          <div className="label mb-1">Membro desde</div>
          <div className="mb-3 text-sm text-fg-2">{formatDate(p.created_at)}</div>

          {!isMe && (
            <>
              <div className="label mb-1">Servidores em comum{mutual.length ? ` — ${mutual.length}` : ''}</div>
              {mutualIds === undefined ? <Spinner size={14} /> : mutual.length === 0 ? <div className="mb-3 text-sm text-fg-muted">Nenhum servidor em comum.</div> : (
                <ul className="m-0 mb-3 flex list-none flex-wrap gap-2 p-0">
                  {mutual.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 rounded-md bg-[var(--bg-secondary)] py-1 pr-2 pl-1 text-sm">
                      <Avatar path={s.icon_path} name={s.name} id={s.id} size={22} square />{s.name}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {userRoles.length > 0 && (
            <>
              <div className="label mb-1">Cargos</div>
              <div className="mb-1 flex flex-wrap gap-1.5">
                {userRoles.map((r) => (
                  <span key={r.id} className="flex items-center gap-1.5 rounded-md bg-[var(--bg-secondary)] px-2 py-0.5 text-xs font-semibold">
                    <span className="h-3 w-3 rounded-full" style={{ background: r.color }} />{r.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {!isMe && (
          <div className="relative mt-3">
            <input
              className="input pr-10"
              placeholder={`Conversar com @${p.username}`}
              aria-label={`Conversar com @${p.username}`}
              value={text}
              maxLength={4000}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
            />
            <button className="icon-btn absolute top-1 right-1" aria-label="Enviar mensagem direta" data-tip="Enviar" disabled={!text.trim() || busy} onClick={() => void send()}>
              {busy ? <Spinner size={14} /> : <SendHorizontal size={16} />}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
