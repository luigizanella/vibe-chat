import type { QueryClient } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { rpc, supabase } from '@/lib/supabase'
import { attachmentPath, uploadAttachment } from '@/lib/media'
import { uuid } from '@/lib/format'
import { MESSAGE_SELECT, type Message, type PendingAttachment } from '@/lib/types'
import { errorMessage } from '@/lib/errors'
import { useSession } from '@/store/session'
import { qk } from './queries'

export type Scope = { kind: 'channel' | 'dm'; id: string }
export const scopeKey = (s: Scope) => `${s.kind === 'channel' ? 'c' : 'd'}:${s.id}`
export const PAGE = 50

export interface MessagesState {
  items: Message[] // ordem cronológica (mais antiga primeiro)
  hasMore: boolean
}
export const messagesKey = (s: Scope) => ['messages', scopeKey(s)] as const

export async function fetchPage(scope: Scope, before?: string): Promise<{ items: Message[]; hasMore: boolean }> {
  let q = supabase.from('messages').select(MESSAGE_SELECT).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE + 1)
  q = scope.kind === 'channel' ? q.eq('channel_id', scope.id) : q.eq('dm_id', scope.id)
  if (before) q = q.lt('created_at', before)
  const { data, error } = await q
  if (error) throw error
  const rows = (data ?? []) as unknown as Message[]
  const hasMore = rows.length > PAGE
  return { items: rows.slice(0, PAGE).reverse(), hasMore }
}

export async function fetchMessage(id: string): Promise<Message | null> {
  const { data } = await supabase.from('messages').select(MESSAGE_SELECT).eq('id', id).maybeSingle()
  return (data as unknown as Message | null) ?? null
}

export function useMessages(scope: Scope | null) {
  return useQuery({
    queryKey: scope ? messagesKey(scope) : ['messages', 'none'],
    enabled: !!scope,
    staleTime: Infinity, // mantido por realtime; refetch ao reconectar
    queryFn: async (): Promise<MessagesState> => fetchPage(scope!),
  })
}

export function patchMessages(qc: QueryClient, key: readonly unknown[], fn: (s: MessagesState) => MessagesState) {
  qc.setQueryData<MessagesState>(key, (old) => (old ? fn(old) : old))
}

export function upsertMessage(s: MessagesState, m: Message): MessagesState {
  const idx = s.items.findIndex((x) => x.id === m.id)
  if (idx >= 0) {
    const items = s.items.slice()
    items[idx] = { ...m, _status: undefined }
    return { ...s, items }
  }
  const items = [...s.items, m].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
  return { ...s, items }
}

export async function loadOlder(qc: QueryClient, scope: Scope): Promise<void> {
  const state = qc.getQueryData<MessagesState>(messagesKey(scope))
  if (!state?.hasMore || !state.items.length) return
  const oldest = state.items.find((m) => !m._status)
  if (!oldest) return
  const page = await fetchPage(scope, oldest.created_at)
  patchMessages(qc, messagesKey(scope), (s) => {
    const ids = new Set(s.items.map((m) => m.id))
    return { hasMore: page.hasMore, items: [...page.items.filter((m) => !ids.has(m.id)), ...s.items] }
  })
}

export interface SendInput {
  scope: Scope
  content: string
  replyTo?: Message | null
  files?: File[]
}

/** Envio otimista com anexos, estados de falha e reenvio idempotente (mesmo id). */
export async function sendMessage(qc: QueryClient, input: SendInput, existingId?: string, pending?: PendingAttachment[]): Promise<void> {
  const { user, profile } = useSession.getState()
  if (!user || !profile) return
  const id = existingId ?? uuid()
  const key = messagesKey(input.scope)
  const files: PendingAttachment[] =
    pending ?? (input.files ?? []).map((file) => ({ file, path: attachmentPath(input.scope, user.id, file.name) }))

  const optimistic: Message = {
    id,
    channel_id: input.scope.kind === 'channel' ? input.scope.id : null,
    dm_id: input.scope.kind === 'dm' ? input.scope.id : null,
    author_id: user.id,
    content: input.content,
    reply_to_id: input.replyTo?.id ?? null,
    mention_user_ids: [],
    mention_role_ids: [],
    mention_everyone: false,
    edited_at: null,
    pinned_at: null,
    created_at: new Date().toISOString(),
    author: { id: profile.id, username: profile.username, display_name: profile.display_name, avatar_path: profile.avatar_path },
    attachments: files.map((f, i) => ({
      id: `pending-${i}`, message_id: id, storage_path: f.path, file_name: f.file.name,
      content_type: f.file.type || 'application/octet-stream', size_bytes: f.file.size,
    })),
    reactions: [],
    reply: input.replyTo ? { id: input.replyTo.id, content: input.replyTo.content, author_id: input.replyTo.author_id } : null,
    _status: 'sending',
    _pendingAttachments: files,
  }
  patchMessages(qc, key, (s) => upsertMessageKeepStatus(s, optimistic))

  try {
    await Promise.all(files.map((f) => uploadAttachment(f.path, f.file)))
    await rpc('send_message', {
      p_id: id,
      p_channel: input.scope.kind === 'channel' ? input.scope.id : null,
      p_dm: input.scope.kind === 'dm' ? input.scope.id : null,
      p_content: input.content,
      p_reply_to: input.replyTo?.id ?? null,
      p_attachments: files.map((f) => ({ path: f.path, name: f.file.name, type: f.file.type, size: f.file.size })),
    })
    const full = await fetchMessage(id)
    if (full) patchMessages(qc, key, (s) => upsertMessage(s, full))
  } catch (e) {
    const msg = errorMessage(e)
    // rede caiu mas a mensagem pode ter sido gravada: reenviar com o mesmo id é idempotente
    patchMessages(qc, key, (s) => ({
      ...s,
      items: s.items.map((m) => (m.id === id ? { ...m, _status: 'failed' as const, content: m.content } : m)),
    }))
    throw Object.assign(new Error(msg), { messageId: id })
  }
}

function upsertMessageKeepStatus(s: MessagesState, m: Message): MessagesState {
  const idx = s.items.findIndex((x) => x.id === m.id)
  if (idx >= 0) {
    const items = s.items.slice()
    items[idx] = m
    return { ...s, items }
  }
  return { ...s, items: [...s.items, m] }
}

export async function retryMessage(qc: QueryClient, scope: Scope, m: Message): Promise<void> {
  await sendMessage(
    qc,
    { scope, content: m.content, replyTo: m.reply ? ({ id: m.reply.id, content: m.reply.content, author_id: m.reply.author_id } as Message) : null },
    m.id,
    m._pendingAttachments ?? [],
  )
}

export function discardMessage(qc: QueryClient, scope: Scope, id: string) {
  patchMessages(qc, messagesKey(scope), (s) => ({ ...s, items: s.items.filter((m) => m.id !== id) }))
}

export function usePinned(scope: Scope | null, enabled: boolean) {
  return useQuery({
    queryKey: scope ? qk.pins(scopeKey(scope)) : ['pins', 'none'],
    enabled: !!scope && enabled,
    queryFn: async () => {
      let q = supabase.from('messages').select(MESSAGE_SELECT).not('pinned_at', 'is', null).order('pinned_at', { ascending: false })
      q = scope!.kind === 'channel' ? q.eq('channel_id', scope!.id) : q.eq('dm_id', scope!.id)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as Message[]
    },
  })
}
