import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Paperclip, SmilePlus, X, Send, CornerUpLeft, AtSign, Lock } from 'lucide-react'
import { sendMessage, scopeKey } from '@/data/messages'
import { useTyping } from '@/data/presence'
import { useServers } from '@/data/queries'
import { parseMusicCommand, runMusicCommand } from '@/data/music'
import { toast } from '@/store/ui'
import { MAX_ATTACHMENT_BYTES } from '@/lib/media'
import type { Message } from '@/lib/types'
import { Avatar } from '@/components/ui'
import { PendingFiles } from './Attachments'
import { EmojiPicker } from './EmojiPicker'
import { plainPreview } from './Markdown'
import { displayToTokens, useChat, type Mentionable } from './chatContext'

const MAX_FILES = 10

export function Composer({ replyTo, onCancelReply, placeholder }: { replyTo: Message | null; onCancelReply: () => void; placeholder: string }) {
  const ctx = useChat()
  const qc = useQueryClient()
  const key = `vibe.draft.${scopeKey(ctx.scope)}`
  const [text, setText] = useState(() => {
    try {
      return sessionStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })
  const [files, setFiles] = useState<File[]>([])
  const [picker, setPicker] = useState<DOMRect | null>(null)
  const [drag, setDrag] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [mIndex, setMIndex] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const { typers, ping } = useTyping(ctx.scope)
  const { data: servers } = useServers()
  const isMusicChannel = ctx.scope.kind === 'channel' && !!ctx.serverId && servers?.find((s) => s.id === ctx.serverId)?.music_channel_id === ctx.scope.id

  // rascunho persistido por canal
  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(key, text)
      else sessionStorage.removeItem(key)
    } catch {
      /* sem storage */
    }
  }, [text, key])

  useEffect(() => {
    ref.current?.focus()
  }, [ctx.scope.id, replyTo?.id])

  // auto-altura
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  const options = useMemo<Mentionable[]>(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    const all: Mentionable[] = [
      ...(ctx.scope.kind === 'channel' && ctx.canSend ? [{ id: 'everyone', name: 'everyone', username: 'everyone', kind: 'everyone' as const }] : []),
      ...ctx.mentionables,
    ]
    return all
      .filter((m) => (m.username ?? m.name).toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .sort((a, b) => Number((b.username ?? b.name).toLowerCase().startsWith(q)) - Number((a.username ?? a.name).toLowerCase().startsWith(q)))
      .slice(0, 8)
  }, [mention, ctx.mentionables, ctx.scope.kind, ctx.canSend])

  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const m = /(?:^|\s)@([\p{L}\p{N}_. -]{0,32})$/u.exec(before)
    if (m && !/\s{2}/.test(m[1])) {
      setMention({ start: caret - m[1].length - 1, query: m[1] })
      setMIndex(0)
    } else setMention(null)
  }

  const insertMention = (m: Mentionable) => {
    if (!mention || !ref.current) return
    const label = m.kind === 'everyone' ? '@everyone' : m.kind === 'user' ? `@${m.username}` : `@${m.name}`
    const caret = ref.current.selectionStart
    const next = `${text.slice(0, mention.start)}${label} ${text.slice(caret)}`
    setText(next)
    setMention(null)
    requestAnimationFrame(() => {
      const pos = mention.start + label.length + 1
      ref.current?.focus()
      ref.current?.setSelectionRange(pos, pos)
    })
  }

  const addFiles = useCallback((list: FileList | File[]) => {
    if (!ctx.canAttach) return toast.error('Você não tem permissão para anexar arquivos aqui.')
    const incoming = [...list]
    const tooBig = incoming.filter((f) => f.size > MAX_ATTACHMENT_BYTES)
    if (tooBig.length) toast.error(`Arquivo(s) acima de 25 MB: ${tooBig.map((f) => f.name).join(', ')}`)
    setFiles((cur) => {
      const merged = [...cur, ...incoming.filter((f) => f.size <= MAX_ATTACHMENT_BYTES)]
      if (merged.length > MAX_FILES) toast.error(`Máximo de ${MAX_FILES} arquivos por mensagem.`)
      return merged.slice(0, MAX_FILES)
    })
  }, [ctx.canAttach])

  const submit = () => {
    const raw = text.trim()
    if (!raw && !files.length) return
    if (!ctx.canSend) return
    // canal de comandos de música: o bot executa e responde no próprio canal
    if (isMusicChannel && !files.length) {
      const cmd = parseMusicCommand(raw)
      if (cmd) {
        setText('')
        void runMusicCommand(cmd)
        return
      }
    }
    const content = displayToTokens(raw, ctx.mentionables)
    if (/@everyone/.test(content) && !ctx.mentionables.length) {
      /* sem validação local; o servidor ignora @everyone sem permissão */
    }
    const toSend = files
    const reply = replyTo
    setText('')
    setFiles([])
    onCancelReply()
    sendMessage(qc, { scope: ctx.scope, content, replyTo: reply, files: toSend }).catch((e: Error) => toast.error(e.message))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && options.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setMIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(options[mIndex])
        return
      }
      if (e.key === 'Escape') {
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape' && replyTo) onCancelReply()
  }

  const onPaste = (e: ClipboardEvent) => {
    const fl = [...e.clipboardData.files]
    if (fl.length) {
      e.preventDefault()
      addFiles(fl)
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  if (!ctx.canSend) {
    return (
      <div className="mx-4 mb-4 flex items-center gap-2 rounded-lg bg-[var(--bg-input)] px-4 py-3 text-fg-muted">
        <Lock size={16} /> {ctx.blockedReason ?? 'Você não tem permissão para enviar mensagens neste canal.'}
      </div>
    )
  }

  const typingText =
    typers.length === 0 ? '' : typers.length === 1 ? `${typers[0].name} está digitando…` : typers.length === 2 ? `${typers[0].name} e ${typers[1].name} estão digitando…` : 'Várias pessoas estão digitando…'

  return (
    <div className="relative px-4 pb-1" onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
      {mention && options.length > 0 && (
        <div role="listbox" aria-label="Menções" className="absolute right-4 bottom-full left-4 z-10 mb-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow)]">
          {options.map((o, i) => (
            <button key={`${o.kind}${o.id}`} role="option" aria-selected={i === mIndex} onMouseEnter={() => setMIndex(i)} onMouseDown={(e) => { e.preventDefault(); insertMention(o) }}
              className="flex w-full items-center gap-2 rounded border-0 px-2 py-1.5 text-left" style={{ background: i === mIndex ? 'var(--bg-selected)' : 'transparent' }}>
              {o.kind === 'user' ? <Avatar path={o.avatar_path} name={o.name} id={o.id} size={22} /> : <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-tertiary"><AtSign size={13} /></span>}
              <span className="font-semibold" style={o.color ? { color: o.color } : undefined}>{o.kind === 'everyone' ? '@everyone' : o.name}</span>
              {o.kind === 'user' && <span className="text-xs text-fg-muted">@{o.username}</span>}
              {o.kind === 'everyone' && <span className="text-xs text-fg-muted">Notifica todos neste canal</span>}
            </button>
          ))}
        </div>
      )}

      {replyTo && (
        <div className="flex items-center gap-2 rounded-t-lg bg-tertiary px-3 py-1.5 text-xs text-fg-2">
          <CornerUpLeft size={13} /> Respondendo a <strong>{ctx.nameOf(replyTo.author_id)}</strong>
          <span className="min-w-0 flex-1 truncate">{plainPreview(replyTo.content, ctx.resolver, 80)}</span>
          <button className="icon-btn h-5 w-5" onClick={onCancelReply} aria-label="Cancelar resposta"><X size={13} /></button>
        </div>
      )}
      <div className={`relative rounded-lg bg-[var(--bg-input)] ${replyTo ? 'rounded-t-none' : ''} ${drag ? 'outline-2 outline-dashed outline-[var(--accent)]' : ''}`}>
        <PendingFiles files={files} onRemove={(i) => setFiles((f) => f.filter((_, j) => j !== i))} />
        <div className="flex items-end gap-1 px-2 py-2">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
          <button className="icon-btn" onClick={() => fileInput.current?.click()} disabled={!ctx.canAttach} aria-label="Anexar arquivo" data-tip={ctx.canAttach ? 'Anexar arquivo' : 'Sem permissão para anexar'}><Paperclip size={20} /></button>
          <textarea
            ref={ref}
            rows={1}
            value={text}
            maxLength={4000}
            placeholder={isMusicChannel ? 'Comandos de música: /tocar <link> · /pular · /pausar · /continuar · /voltar · /fila · /parar' : placeholder}
            aria-label={placeholder}
            className="max-h-[220px] min-h-[36px] flex-1 resize-none border-0 bg-transparent px-1 py-2 text-[0.95rem] outline-none"
            onChange={(e) => {
              setText(e.target.value)
              detectMention(e.target.value, e.target.selectionStart)
              if (e.target.value) ping()
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onClick={(e) => detectMention(text, e.currentTarget.selectionStart)}
          />
          <button className="icon-btn" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())} aria-label="Emojis" data-tip="Emojis"><SmilePlus size={20} /></button>
          <button className="icon-btn" onClick={submit} disabled={!text.trim() && !files.length} aria-label="Enviar" data-tip="Enviar (Enter)"><Send size={19} /></button>
        </div>
      </div>
      <div className="flex h-5 items-center justify-between px-1 text-[11px] text-fg-muted" aria-live="polite">
        <span>{typingText}</span>
        {text.length > 3500 && <span className={text.length >= 4000 ? 'text-danger' : ''}>{text.length}/4000</span>}
      </div>
      {picker && (
        <EmojiPicker anchor={picker} onClose={() => setPicker(null)} onPick={(e) => {
          const el = ref.current
          const pos = el?.selectionStart ?? text.length
          setText((t) => t.slice(0, pos) + e + t.slice(pos))
          requestAnimationFrame(() => el?.focus())
        }} />
      )}
    </div>
  )
}
