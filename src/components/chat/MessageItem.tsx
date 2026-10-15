import { memo, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertCircle, CornerUpLeft, Copy, Pencil, Pin, PinOff, SmilePlus, Trash2, Reply, MoreHorizontal } from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { formatMessageStamp, formatTime } from '@/lib/format'
import { QUICK_REACTIONS } from '@/lib/emoji'
import type { Message } from '@/lib/types'
import { Avatar, confirmAction } from '@/components/ui'
import { toast, useUI } from '@/store/ui'
import { useSession } from '@/store/session'
import { discardMessage, retryMessage } from '@/data/messages'
import { MessageContent, plainPreview } from './Markdown'
import { AttachmentView } from './Attachments'
import { EmojiPicker } from './EmojiPicker'
import { displayToTokens, tokensToDisplay, useChat } from './chatContext'

interface Props {
  m: Message
  compact: boolean
  onReply: (m: Message) => void
  highlighted?: boolean
}

function MessageItemBase({ m, compact, onReply, highlighted }: Props) {
  const ctx = useChat()
  const qc = useQueryClient()
  const me = useSession((s) => s.user?.id)
  const openMenu = useUI((s) => s.openMenu)
  const openProfile = useUI((s) => s.openProfile)
  const [editing, setEditing] = useState(false)
  const [picker, setPicker] = useState<DOMRect | null>(null)
  const isMine = m.author_id === me
  const authorName = m.author?.display_name || m.author?.username || (m.author_id ? ctx.nameOf(m.author_id) : 'Usuário excluído')
  const color = ctx.colorOf(m.author_id)
  const mentionedMe = !!me && (m.mention_user_ids.includes(me) || m.mention_everyone)
  const pendingByPath = new Map(m._pendingAttachments?.map((p) => [p.path, p]))

  const react = (emoji: string) => {
    if (!ctx.canReact) return toast.error('Você não pode reagir neste canal.')
    rpc('toggle_reaction', { p_id: m.id, p_emoji: emoji }).catch((e) => toast.error(errorMessage(e)))
  }

  const togglePin = () =>
    rpc('set_pinned', { p_id: m.id, p_pinned: !m.pinned_at }).then(
      () => toast.success(m.pinned_at ? 'Mensagem desafixada.' : 'Mensagem fixada.'),
      (e) => toast.error(errorMessage(e)),
    )

  const remove = () =>
    confirmAction({
      title: 'Apagar mensagem',
      message: (
        <div className="rounded border border-border bg-secondary p-3">
          <div className="mb-1 font-semibold">{authorName}</div>
          <div className="line-clamp-4 text-fg-2">{plainPreview(m.content, ctx.resolver, 300) || '📎 Anexo'}</div>
        </div>
      ),
      confirmLabel: 'Apagar',
      danger: true,
      onConfirm: async () => {
        await rpc('delete_message', { p_id: m.id })
      },
    })

  const canDelete = isMine || ctx.canManageMessages
  const canPin = ctx.scope.kind === 'dm' || ctx.canManageMessages
  const sending = m._status === 'sending'
  const failed = m._status === 'failed'

  const menuItems = () => [
    { label: 'Responder', icon: <Reply size={14} />, onClick: () => onReply(m), disabled: !ctx.canSend },
    { label: 'Reagir com 👍', icon: <SmilePlus size={14} />, onClick: () => react('👍'), disabled: !ctx.canReact },
    { label: 'Copiar texto', icon: <Copy size={14} />, onClick: () => void navigator.clipboard.writeText(plainPreview(m.content, ctx.resolver, 4000)).then(() => toast.success('Texto copiado.')), disabled: !m.content },
    { separator: true },
    { label: 'Editar mensagem', icon: <Pencil size={14} />, onClick: () => setEditing(true), disabled: !isMine || sending },
    { label: m.pinned_at ? 'Desafixar mensagem' : 'Fixar mensagem', icon: m.pinned_at ? <PinOff size={14} /> : <Pin size={14} />, onClick: () => void togglePin(), disabled: !canPin || sending },
    { separator: true },
    { label: 'Apagar mensagem', icon: <Trash2 size={14} />, danger: true, onClick: remove, disabled: !canDelete || sending },
  ]

  // agrupa reações
  const groups = new Map<string, { count: number; mine: boolean; users: string[] }>()
  for (const r of m.reactions ?? []) {
    const g = groups.get(r.emoji) ?? { count: 0, mine: false, users: [] }
    g.count++
    g.mine ||= r.user_id === me
    g.users.push(ctx.nameOf(r.user_id))
    groups.set(r.emoji, g)
  }

  const showProfile = (e: React.MouseEvent) => m.author_id && openProfile(m.author_id, ctx.serverId, e.clientX, e.clientY)
  const profileProps = m.author_id
    ? { role: 'button' as const, tabIndex: 0, onClick: showProfile, onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && openProfile(m.author_id!, ctx.serverId, 200, 200) }
    : {}

  return (
    <div
      id={`msg-${m.id}`}
      className={clsx(
        'group relative flex gap-4 px-4 py-0.5 hover:bg-[var(--bg-hover)] focus-within:bg-[var(--bg-hover)]',
        !compact && 'mt-4 pt-0.5',
        mentionedMe && 'border-l-2 border-[var(--accent)] bg-[var(--bg-mention)] pl-3.5',
        highlighted && 'bg-[var(--accent-soft)]',
        sending && 'opacity-60',
      )}
      style={highlighted ? { transition: 'background 1.5s' } : undefined}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(e.clientX, e.clientY, menuItems().filter((i) => i.separator || i.label))
      }}
    >
      {!compact ? (
        <div className="mt-0.5 shrink-0 cursor-pointer" {...profileProps}>
          <Avatar path={m.author?.avatar_path} name={authorName} id={m.author_id ?? m.id} size={40} />
        </div>
      ) : (
        <div className="w-10 shrink-0 pt-1 text-right text-[10px] leading-5 text-fg-muted opacity-0 group-hover:opacity-100" aria-hidden>
          {formatTime(m.created_at)}
        </div>
      )}

      <div className="min-w-0 flex-1">
        {m.reply && (
          <button
            className="mb-0.5 flex max-w-full items-center gap-1.5 border-0 bg-transparent p-0 text-xs text-fg-2 hover:text-fg"
            onClick={() => document.getElementById(`msg-${m.reply!.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
          >
            <CornerUpLeft size={12} />
            <span className="font-semibold">{ctx.nameOf(m.reply.author_id)}</span>
            <span className="truncate">{plainPreview(m.reply.content, ctx.resolver, 80) || '📎 Anexo'}</span>
          </button>
        )}
        {m.reply_to_id && !m.reply && <div className="mb-0.5 text-xs text-fg-muted italic">Mensagem original apagada</div>}

        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className={clsx('font-semibold', m.author_id && 'cursor-pointer hover:underline')} style={color ? { color } : undefined} {...profileProps}>
              {authorName}
            </span>
            <time className="text-[11px] text-fg-muted" dateTime={m.created_at} title={new Date(m.created_at).toLocaleString('pt-BR')}>
              {formatMessageStamp(m.created_at)}
            </time>
            {m.pinned_at && <Pin size={11} className="text-fg-muted" aria-label="Fixada" />}
          </div>
        )}

        {editing ? (
          <EditBox m={m} onDone={() => setEditing(false)} />
        ) : (
          <>
            {m.content && (
              <div className="text-[0.95rem] leading-[1.4]">
                <MessageContent text={m.content} resolver={ctx.resolver} />
                {m.edited_at && <span className="ml-1 text-[10px] text-fg-muted" title={new Date(m.edited_at).toLocaleString('pt-BR')}>(editada)</span>}
              </div>
            )}
            {m.attachments?.map((a) => <AttachmentView key={a.id} att={a} pending={pendingByPath.get(a.storage_path)} />)}
          </>
        )}

        {groups.size > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {[...groups.entries()].map(([emoji, g]) => (
              <button
                key={emoji}
                onClick={() => react(emoji)}
                data-tip={g.users.slice(0, 10).join(', ')}
                aria-pressed={g.mine}
                aria-label={`${emoji} ${g.count}`}
                className={clsx('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs', g.mine ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-transparent bg-tertiary hover:border-[var(--border-strong)]')}
              >
                <span className="text-sm">{emoji}</span><span className="font-semibold">{g.count}</span>
              </button>
            ))}
          </div>
        )}

        {failed && (
          <div className="mt-1 flex items-center gap-2 text-xs text-danger" role="alert">
            <AlertCircle size={14} /> Falha ao enviar.
            <button className="btn btn-sm" onClick={() => void retryMessage(qc, ctx.scope, m).catch((e) => toast.error((e as Error).message))}>Tentar novamente</button>
            <button className="btn btn-sm btn-ghost" onClick={() => discardMessage(qc, ctx.scope, m.id)}>Descartar</button>
          </div>
        )}
        {sending && <div className="mt-1 text-xs text-fg-muted">Enviando…</div>}
      </div>

      {!sending && !failed && !editing && (
        <div className="absolute -top-4 right-3 flex rounded-md border border-border bg-[var(--bg-elevated)] opacity-0 shadow group-hover:opacity-100 focus-within:opacity-100">
          {ctx.canReact && QUICK_REACTIONS.slice(0, 2).map((e) => (
            <button key={e} className="icon-btn h-7 w-7" onClick={() => react(e)} aria-label={`Reagir com ${e}`}>{e}</button>
          ))}
          <button className="icon-btn h-7 w-7" disabled={!ctx.canReact} data-tip="Adicionar reação" aria-label="Adicionar reação" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}><SmilePlus size={16} /></button>
          <button className="icon-btn h-7 w-7" disabled={!ctx.canSend} data-tip="Responder" aria-label="Responder" onClick={() => onReply(m)}><Reply size={16} /></button>
          {isMine && <button className="icon-btn h-7 w-7" data-tip="Editar" aria-label="Editar" onClick={() => setEditing(true)}><Pencil size={16} /></button>}
          <button className="icon-btn h-7 w-7" data-tip="Mais" aria-label="Mais ações" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, menuItems().filter((i) => i.separator || i.label)) }}><MoreHorizontal size={16} /></button>
        </div>
      )}
      {picker && <EmojiPicker anchor={picker} onClose={() => setPicker(null)} onPick={(e) => { setPicker(null); react(e) }} />}
    </div>
  )
}

function EditBox({ m, onDone }: { m: Message; onDone: () => void }) {
  const ctx = useChat()
  const [text, setText] = useState(() => tokensToDisplay(m.content, ctx.mentionables))
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.setSelectionRange(text.length, text.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const save = async () => {
    const content = displayToTokens(text.trim(), ctx.mentionables)
    if (content === m.content) return onDone()
    if (!content && !m.attachments?.length) return toast.error('A mensagem não pode ficar vazia. Use "Apagar".')
    setBusy(true)
    try {
      await rpc('edit_message', { p_id: m.id, p_content: content })
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <div>
      <textarea
        ref={ref}
        className="textarea min-h-[44px]"
        value={text}
        maxLength={4000}
        disabled={busy}
        aria-label="Editar mensagem"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void save()
          }
          if (e.key === 'Escape') onDone()
        }}
      />
      <div className="mt-1 text-xs text-fg-muted">
        Esc para <button className="border-0 bg-transparent p-0 text-[var(--text-link)]" onClick={onDone}>cancelar</button> • Enter para <button className="border-0 bg-transparent p-0 text-[var(--text-link)]" onClick={() => void save()}>salvar</button>
      </div>
    </div>
  )
}

export const MessageItem = memo(MessageItemBase)
