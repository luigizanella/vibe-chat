import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, Loader2, Pin, PinOff, Search, X } from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { formatDay, formatMessageStamp, sameDay } from '@/lib/format'
import { MESSAGE_SELECT, type Message } from '@/lib/types'
import { loadOlder, scopeKey, useMessages, usePinned, type MessagesState, type Scope, messagesKey } from '@/data/messages'
import { qk } from '@/data/queries'
import { useUI, toast } from '@/store/ui'
import { Avatar, CenterSpinner, EmptyState, ErrorState, IconButton, Spinner } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { MessageItem } from './MessageItem'
import { Composer } from './Composer'
import { ChatContext, type ChatCtx } from './chatContext'
import { MessageContent, plainPreview } from './Markdown'

function sameGroup(a: Message, b: Message): boolean {
  return (
    a.author_id === b.author_id &&
    !!a.author_id &&
    !b.reply_to_id &&
    sameDay(a.created_at, b.created_at) &&
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime() < 7 * 60_000
  )
}

function MessageList({ scope, onReply, highlight }: { scope: Scope; onReply: (m: Message) => void; highlight: string | null }) {
  const qc = useQueryClient()
  const { data, isLoading, error, refetch } = useMessages(scope)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const prev = useRef<{ first?: string; last?: string; height: number }>({ height: 0 })
  const [showJump, setShowJump] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const items = data?.items ?? []

  const scrollToBottom = useCallback((smooth = false) => {
    const el = ref.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // roda a cada render de propósito: mantém a posição de rolagem após qualquer mudança da lista
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !data) return
    const first = items[0]?.id
    const last = items[items.length - 1]?.id
    const p = prev.current
    if (p.first === undefined) scrollToBottom()
    else if (first !== p.first && last === p.last) el.scrollTop += el.scrollHeight - p.height // histórico carregado acima
    else if (last !== p.last) {
      const mine = items[items.length - 1]?._status === 'sending'
      if (stick.current || mine) scrollToBottom()
      else setShowJump(true)
    }
    prev.current = { first, last, height: el.scrollHeight }
  })

  // imagens carregando mudam a altura: mantém no fim se estava colado
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (stick.current) scrollToBottom()
    })
    const inner = el.firstElementChild
    if (inner) ro.observe(inner)
    return () => ro.disconnect()
  }, [scrollToBottom, isLoading])

  // marcar como lido
  useEffect(() => {
    if (!data) return
    const mark = () => {
      if (!document.hasFocus()) return
      void rpc('mark_read', scope.kind === 'channel' ? { p_channel: scope.id } : { p_dm: scope.id }).then(() => qc.invalidateQueries({ queryKey: qk.unread }))
    }
    mark()
    window.addEventListener('focus', mark)
    return () => window.removeEventListener('focus', mark)
  }, [!!data, scope.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // pular para mensagem (busca / fixadas)
  useEffect(() => {
    if (!highlight || !data) return
    let cancelled = false
    void (async () => {
      for (let i = 0; i < 20; i++) {
        const st = qc.getQueryData<MessagesState>(messagesKey(scope))
        if (st?.items.some((m) => m.id === highlight)) break
        if (!st?.hasMore) break
        await loadOlder(qc, scope)
      }
      if (cancelled) return
      requestAnimationFrame(() => document.getElementById(`msg-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
      setTimeout(() => useUI.getState().setJumpTo(null), 2500)
    })()
    return () => {
      cancelled = true
    }
  }, [highlight, !!data]) // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stick.current = near
    if (near) setShowJump(false)
    if (el.scrollTop < 160 && data?.hasMore && !loadingOlder) {
      setLoadingOlder(true)
      loadOlder(qc, scope).finally(() => setLoadingOlder(false))
    }
  }

  if (isLoading) return <CenterSpinner />
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} className="h-full overflow-y-auto overflow-x-hidden" onScroll={onScroll} role="log" aria-live="polite" aria-label="Mensagens">
        <div className="flex min-h-full flex-col justify-end pb-4">
          {data?.hasMore ? (
            <div className="grid h-10 place-items-center text-fg-muted">{loadingOlder ? <Loader2 className="spin" size={18} /> : null}</div>
          ) : (
            <div className="px-4 pt-8 pb-2">
              <h3 className="m-0 text-2xl font-bold">{items.length ? 'Início da conversa' : 'Nada por aqui ainda'}</h3>
              <p className="mt-1 text-fg-2">{items.length ? 'Este é o começo do histórico.' : 'Seja o primeiro a escrever uma mensagem!'}</p>
            </div>
          )}
          {items.map((m, i) => {
            const before = items[i - 1]
            const newDay = !before || !sameDay(before.created_at, m.created_at)
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="mx-4 mt-4 flex items-center gap-3 text-xs font-semibold text-fg-muted" role="separator">
                    <div className="h-px flex-1 bg-[var(--border-strong)]" />{formatDay(m.created_at)}<div className="h-px flex-1 bg-[var(--border-strong)]" />
                  </div>
                )}
                <MessageItem m={m} compact={!newDay && !!before && sameGroup(before, m)} onReply={onReply} highlighted={highlight === m.id} />
              </div>
            )
          })}
        </div>
      </div>
      {showJump && (
        <button className="btn btn-primary absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-lg" onClick={() => { scrollToBottom(true); setShowJump(false) }}>
          <ArrowDown size={16} /> Novas mensagens
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ painéis */
function PinsPanel({ scope, onClose }: { scope: Scope; onClose: () => void }) {
  const { data, isLoading } = usePinned(scope, true)
  const qc = useQueryClient()
  const setJumpTo = useUI((s) => s.setJumpTo)
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[360px] flex-col border-l border-border bg-secondary shadow-[var(--shadow)]" aria-label="Mensagens fixadas">
      <header className="flex h-12 items-center justify-between border-b border-border px-4 font-bold"><span className="flex items-center gap-2"><Pin size={16} /> Mensagens fixadas</span><IconButton label="Fechar" onClick={onClose}><X size={18} /></IconButton></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading ? <CenterSpinner /> : !data?.length ? <EmptyState icon={<Pin />} title="Nenhuma mensagem fixada">Fixe mensagens importantes pelo menu “mais” de cada mensagem.</EmptyState> : data.map((m) => (
          <PinnedItem key={m.id} m={m} onJump={() => { setJumpTo(m.id); onClose() }} onUnpin={() => rpc('set_pinned', { p_id: m.id, p_pinned: false }).then(() => qc.invalidateQueries({ queryKey: qk.pins(scopeKey(scope)) }), (e) => toast.error(errorMessage(e)))} />
        ))}
      </div>
    </aside>
  )
}

function PinnedItem({ m, onJump, onUnpin }: { m: Message; onJump: () => void; onUnpin: () => void }) {
  return (
    <div className="mb-2 rounded-md border border-border bg-primary p-3">
      <div className="mb-1 flex items-center gap-2 text-xs"><strong>{m.author?.display_name || m.author?.username || 'Usuário'}</strong><span className="text-fg-muted">{formatMessageStamp(m.created_at)}</span></div>
      <div className="line-clamp-4 text-fg-2">{plainPreview(m.content, undefined, 240) || '📎 Anexo'}</div>
      <div className="mt-2 flex gap-2"><button className="btn btn-sm" onClick={onJump}>Ir para a mensagem</button><button className="btn btn-sm btn-ghost" onClick={onUnpin}><PinOff size={13} /> Desafixar</button></div>
    </div>
  )
}

export function SearchPanel({ scope, serverId, onClose, onOpenResult }: { scope: Scope; serverId: string | null; onClose: () => void; onOpenResult?: (m: Message) => void }) {
  const [q, setQ] = useState('')
  const [where, setWhere] = useState<'channel' | 'server'>('channel')
  const [results, setResults] = useState<Message[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setJumpTo = useUI((s) => s.setJumpTo)

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null)
      return
    }
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const args: Record<string, unknown> =
          scope.kind === 'dm' ? { p_query: q, p_dm: scope.id } : where === 'server' && serverId ? { p_query: q, p_server: serverId } : { p_query: q, p_channel: scope.id }
        const { data: ids, error: err } = await supabase.rpc('search_messages', { ...args, p_limit: 30 })
        if (err) throw err
        const found = (ids ?? []) as { id: string }[]
        if (!found.length) setResults([])
        else {
          const { data } = await supabase.from('messages').select(MESSAGE_SELECT).in('id', found.map((r) => r.id)).order('created_at', { ascending: false })
          setResults((data ?? []) as unknown as Message[])
        }
        setError(null)
      } catch (e) {
        setError(errorMessage(e))
      } finally {
        setBusy(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [q, where, scope.id, scope.kind, serverId])

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[380px] flex-col border-l border-border bg-secondary shadow-[var(--shadow)]" aria-label="Busca de mensagens">
      <header className="flex h-12 items-center gap-2 border-b border-border px-3">
        <Search size={16} className="text-fg-muted" />
        <input className="min-w-0 flex-1 border-0 bg-transparent outline-none" placeholder="Buscar mensagens…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Buscar mensagens" />
        {busy && <Spinner size={14} />}
        <IconButton label="Fechar busca" onClick={onClose}><X size={18} /></IconButton>
      </header>
      {scope.kind === 'channel' && serverId && (
        <div className="flex gap-1 border-b border-border p-2" role="tablist">
          {(['channel', 'server'] as const).map((w) => (
            <button key={w} role="tab" aria-selected={where === w} className={`btn btn-sm flex-1 ${where === w ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setWhere(w)}>{w === 'channel' ? 'Neste canal' : 'No servidor'}</button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error ? <ErrorState error={error} /> : results === null ? <EmptyState icon={<Search />} title="Pesquisar">Digite ao menos 2 caracteres.</EmptyState> : !results.length && !busy ? <EmptyState title="Sem resultados" /> : results.map((m) => (
          <button key={m.id} className="mb-1 flex w-full gap-2 rounded-md border-0 bg-transparent p-2 text-left hover:bg-[var(--bg-hover)]" onClick={() => { if (onOpenResult) onOpenResult(m); else setJumpTo(m.id) }}>
            <Avatar path={m.author?.avatar_path} name={m.author?.display_name || m.author?.username || '?'} id={m.author_id ?? m.id} size={28} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2 text-xs"><strong>{m.author?.display_name || m.author?.username || 'Usuário'}</strong><span className="text-fg-muted">{formatMessageStamp(m.created_at)}</span></span>
              <span className="line-clamp-3 text-fg-2">{plainPreview(m.content, undefined, 200)}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ ChatView */
export function ChatView({
  ctx, header, placeholder, panel, onPanelChange,
}: {
  ctx: ChatCtx
  header: (tools: { pins: () => ReactNode; search: () => ReactNode }) => ReactNode
  placeholder: string
  panel: 'pins' | 'search' | null
  onPanelChange: (p: 'pins' | 'search' | null) => void
}) {
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const jumpTo = useUI((s) => s.jumpTo)
  const key = scopeKey(ctx.scope)
  useEffect(() => setReplyTo(null), [key])

  return (
    <ChatContext.Provider value={ctx}>
      <div className="relative flex h-full min-w-0 flex-col bg-primary">
        {header({
          pins: () => <IconButton label="Mensagens fixadas" aria-pressed={panel === 'pins'} onClick={() => onPanelChange(panel === 'pins' ? null : 'pins')}><Pin size={20} /></IconButton>,
          search: () => <IconButton label="Buscar (Ctrl+F)" aria-pressed={panel === 'search'} onClick={() => onPanelChange(panel === 'search' ? null : 'search')}><Search size={20} /></IconButton>,
        })}
        <MessageList key={key} scope={ctx.scope} onReply={setReplyTo} highlight={jumpTo} />
        <Composer replyTo={replyTo} onCancelReply={() => setReplyTo(null)} placeholder={placeholder} />
        {panel === 'pins' && <PinsPanel scope={ctx.scope} onClose={() => onPanelChange(null)} />}
        {panel === 'search' && <SearchPanel scope={ctx.scope} serverId={ctx.serverId} onClose={() => onPanelChange(null)} />}
      </div>
    </ChatContext.Provider>
  )
}

export { MessageContent }
