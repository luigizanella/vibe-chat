import { Fragment, type ReactNode } from 'react'

export interface MentionResolver {
  user: (id: string) => { name: string } | null
  role: (id: string) => { name: string; color: string } | null
  onUserClick?: (id: string, e: React.MouseEvent) => void
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
// ordem importa: mais específicos primeiro
const INLINE = new RegExp(
  [
    '`([^`\\n]+)`', // 1 código
    '\\*\\*([^*\\n]+)\\*\\*', // 2 negrito
    '__([^_\\n]+)__', // 3 sublinhado
    '(?<![*\\w])\\*([^*\\n]+)\\*(?!\\*)', // 4 itálico
    '~~([^~\\n]+)~~', // 5 tachado
    `<@(${UUID})>`, // 6 usuário
    `<@&(${UUID})>`, // 7 cargo
    '(@everyone)', // 8
    '(https?:\\/\\/[^\\s<>"\']+[^\\s<>"\'.,;:!?)\\]])', // 9 link
  ].join('|'),
  'g',
)

function renderInline(text: string, r: MentionResolver, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(text.slice(last, idx))
    const key = `${keyBase}-${n++}`
    if (m[1] !== undefined) out.push(<code key={key}>{m[1]}</code>)
    else if (m[2] !== undefined) out.push(<strong key={key}>{renderInline(m[2], r, key)}</strong>)
    else if (m[3] !== undefined) out.push(<u key={key}>{renderInline(m[3], r, key)}</u>)
    else if (m[4] !== undefined) out.push(<em key={key}>{renderInline(m[4], r, key)}</em>)
    else if (m[5] !== undefined) out.push(<s key={key}>{renderInline(m[5], r, key)}</s>)
    else if (m[6] !== undefined) {
      const u = r.user(m[6])
      out.push(
        <span key={key} className="mention" role="button" tabIndex={0} onClick={(e) => r.onUserClick?.(m[6], e)} onKeyDown={(e) => e.key === 'Enter' && r.onUserClick?.(m[6], e as unknown as React.MouseEvent)}>
          @{u?.name ?? 'usuário desconhecido'}
        </span>,
      )
    } else if (m[7] !== undefined) {
      const role = r.role(m[7])
      out.push(
        <span key={key} className="mention" style={role ? { color: role.color } : undefined}>
          @{role?.name ?? 'cargo removido'}
        </span>,
      )
    } else if (m[8] !== undefined) out.push(<span key={key} className="mention">@everyone</span>)
    else if (m[9] !== undefined)
      out.push(
        <a key={key} href={m[9]} target="_blank" rel="noopener noreferrer nofollow">
          {m[9]}
        </a>,
      )
    last = idx + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Renderiza markdown leve sem HTML bruto (seguro contra XSS: tudo passa por React). */
export function MessageContent({ text, resolver }: { text: string; resolver: MentionResolver }) {
  const parts: ReactNode[] = []
  const blockRe = /```(?:[\w-]*\n)?([\s\S]*?)```/g
  let last = 0
  let i = 0
  const pushText = (chunk: string) => {
    const lines = chunk.split('\n')
    lines.forEach((line, li) => {
      const quote = /^>\s?(.*)$/.exec(line)
      const key = `l${i++}`
      if (quote) parts.push(<blockquote key={key}>{renderInline(quote[1], resolver, key)}</blockquote>)
      else {
        parts.push(<Fragment key={key}>{renderInline(line, resolver, key)}</Fragment>)
        if (li < lines.length - 1 && !(lines[li + 1] ?? '').startsWith('>')) parts.push(<br key={`${key}b`} />)
      }
    })
  }
  for (const m of text.matchAll(blockRe)) {
    const idx = m.index ?? 0
    if (idx > last) pushText(text.slice(last, idx))
    parts.push(<pre key={`p${i++}`}><code>{m[1].replace(/\n$/, '')}</code></pre>)
    last = idx + m[0].length
  }
  if (last < text.length) pushText(text.slice(last))
  return <div className="msg-content break-words whitespace-pre-wrap">{parts}</div>
}

/** Texto simples para prévias (respostas, notificações). */
export function plainPreview(text: string, resolver?: MentionResolver, max = 100): string {
  const t = text
    .replace(new RegExp(`<@(${UUID})>`, 'g'), (_m, id: string) => `@${resolver?.user(id)?.name ?? 'usuário'}`)
    .replace(new RegExp(`<@&(${UUID})>`, 'g'), (_m, id: string) => `@${resolver?.role(id)?.name ?? 'cargo'}`)
    .replace(/```[\s\S]*?```/g, '[código]')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}
