/** Utilitários do YouTube (somente links; nunca baixamos áudio). */

const ID = /^[A-Za-z0-9_-]{11}$/

/** Extrai o ID de um vídeo de links youtube.com, music.youtube.com, youtu.be, /shorts, /embed, /live. */
export function parseYouTubeId(input: string): string | null {
  const raw = input.trim()
  if (ID.test(raw)) return raw
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '')
  let id: string | null = null
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else {
      const m = /^\/(shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname)
      id = m?.[2] ?? null
    }
  }
  return id && ID.test(id) ? id : null
}

/** Procura o primeiro link de YouTube dentro de um texto. */
export function findYouTubeId(text: string): string | null {
  for (const m of text.matchAll(/(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\/[^\s<>"']+/gi)) {
    const id = parseYouTubeId(m[0])
    if (id) return id
  }
  return null
}

export const thumbUrl = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`

/** Título do vídeo via oEmbed oficial (aceita chamadas do navegador). Falha silenciosa. */
export async function fetchTitle(id: string): Promise<string> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(id))}&format=json`)
    if (!r.ok) return 'Vídeo do YouTube'
    const j = (await r.json()) as { title?: string }
    return (j.title ?? 'Vídeo do YouTube').slice(0, 200)
  } catch {
    return 'Vídeo do YouTube'
  }
}

export interface MusicCommand {
  name: 'tocar' | 'pular' | 'pausar' | 'continuar' | 'voltar' | 'fila' | 'parar' | 'ajuda'
  arg: string
}

/** Interpreta "/tocar <link>", "/pular"… (ou um link solto, tratado como /tocar). */
export function parseMusicCommand(text: string): MusicCommand | null {
  const t = text.trim()
  const m = /^\/(tocar|play|pular|skip|pausar|pause|continuar|resume|voltar|back|fila|queue|parar|stop|ajuda|help)\b\s*(.*)$/i.exec(t)
  if (m) {
    const map: Record<string, MusicCommand['name']> = { play: 'tocar', skip: 'pular', pause: 'pausar', resume: 'continuar', back: 'voltar', queue: 'fila', stop: 'parar', help: 'ajuda' }
    const n = m[1].toLowerCase()
    return { name: (map[n] ?? n) as MusicCommand['name'], arg: m[2].trim() }
  }
  if (findYouTubeId(t) && t.split(/\s+/).length <= 2) return { name: 'tocar', arg: t }
  return null
}
