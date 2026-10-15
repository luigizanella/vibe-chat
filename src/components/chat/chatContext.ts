import { createContext, useContext } from 'react'
import type { Scope } from '@/data/messages'
import type { MentionResolver } from './Markdown'

export interface Mentionable {
  id: string
  name: string // exibição
  username?: string
  avatar_path?: string | null
  color?: string
  kind: 'user' | 'role' | 'everyone'
}

export interface ChatCtx {
  scope: Scope
  serverId: string | null
  resolver: MentionResolver
  mentionables: Mentionable[]
  nameOf: (userId: string | null | undefined) => string
  colorOf: (userId: string | null | undefined) => string | undefined
  canSend: boolean
  canAttach: boolean
  canReact: boolean
  canManageMessages: boolean
  /** Motivo exibido no compositor quando não pode enviar. */
  blockedReason?: string
}

export const ChatContext = createContext<ChatCtx | null>(null)
export function useChat(): ChatCtx {
  const c = useContext(ChatContext)
  if (!c) throw new Error('ChatContext ausente')
  return c
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Converte "@usuario" digitado em tokens <@uuid> (usuários e cargos) antes de enviar. */
export function displayToTokens(text: string, items: Mentionable[]): string {
  let out = text
  const users = items.filter((m) => m.kind === 'user' && m.username).sort((a, b) => b.username!.length - a.username!.length)
  for (const u of users) {
    out = out.replace(new RegExp(`(^|[^\\w<@&])@${escapeRe(u.username!)}(?![\\w.]*[\\w])`, 'gi'), (_m, pre: string) => `${pre}<@${u.id}>`)
  }
  const roles = items.filter((m) => m.kind === 'role').sort((a, b) => b.name.length - a.name.length)
  for (const r of roles) {
    out = out.replace(new RegExp(`(^|[^\\w<@&])@${escapeRe(r.name)}(?![\\p{L}\\p{N}_])`, 'gu'), (_m, pre: string) => `${pre}<@&${r.id}>`)
  }
  return out
}

/** Converte tokens em "@usuario" para edição. */
export function tokensToDisplay(text: string, items: Mentionable[]): string {
  return text
    .replace(/<@&([0-9a-f-]{36})>/gi, (m, id: string) => {
      const r = items.find((x) => x.kind === 'role' && x.id === id)
      return r ? `@${r.name}` : m
    })
    .replace(/<@([0-9a-f-]{36})>/gi, (m, id: string) => {
      const u = items.find((x) => x.kind === 'user' && x.id === id)
      return u?.username ? `@${u.username}` : m
    })
}
