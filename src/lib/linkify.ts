export type LinkPart = { type: 'text'; text: string } | { type: 'link'; text: string; href: string }

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi

/**
 * Divide um texto em partes de texto puro e links. Só URLs http/https válidas e sem credenciais embutidas
 * viram link; qualquer outro esquema (javascript:, data:, file:…) permanece texto. Nunca gera HTML.
 */
export function linkify(input: string): LinkPart[] {
  const parts: LinkPart[] = []
  let last = 0
  const push = (text: string) => {
    if (!text) return
    const prev = parts[parts.length - 1]
    if (prev?.type === 'text') prev.text += text
    else parts.push({ type: 'text', text })
  }
  for (const m of input.matchAll(URL_RE)) {
    const start = m.index ?? 0
    let raw = m[0]
    // mantém parênteses balanceados (ex.: wikipedia) e remove pontuação final
    let trail = ''
    while (raw.length && '.,;:!?)]}'.includes(raw[raw.length - 1])) {
      const ch = raw[raw.length - 1]
      if (ch === ')' && (raw.match(/\(/g)?.length ?? 0) >= (raw.match(/\)/g)?.length ?? 0)) break
      trail = ch + trail
      raw = raw.slice(0, -1)
    }
    let href: string | null = null
    try {
      const u = new URL(raw)
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname && !u.username && !u.password) href = u.href
    } catch {
      href = null
    }
    push(input.slice(last, start))
    if (href) {
      parts.push({ type: 'link', text: raw, href })
      push(trail)
    } else push(raw + trail)
    last = start + m[0].length
  }
  push(input.slice(last))
  return parts
}
