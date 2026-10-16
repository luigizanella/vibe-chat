import { describe, expect, it } from 'vitest'
import { findYouTubeId, parseMusicCommand, parseYouTubeId } from '@/lib/youtube'

const ID = 'dQw4w9WgXcQ'
describe('links do YouTube', () => {
  it('extrai o id dos formatos comuns', () => {
    for (const u of [
      `https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&t=42s`, `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}&list=abc`, `https://youtu.be/${ID}?si=xyz`, `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/embed/${ID}`, `youtu.be/${ID}`, ID,
    ]) expect(parseYouTubeId(u), u).toBe(ID)
  })
  it('rejeita o que não é vídeo do YouTube', () => {
    for (const u of ['', 'https://example.com/watch?v=' + ID, 'https://youtube.com.evil.com/watch?v=' + ID, 'javascript:alert(1)', 'https://www.youtube.com/watch?v=curto', 'https://www.youtube.com/', 'ftp://youtu.be/' + ID, 'oi tudo bem'])
      expect(parseYouTubeId(u), u).toBeNull()
  })
  it('acha o link no meio do texto', () => {
    expect(findYouTubeId(`toca isso aí https://youtu.be/${ID} por favor`)).toBe(ID)
    expect(findYouTubeId('sem link')).toBeNull()
  })
})

describe('comandos do bot', () => {
  it('interpreta comandos em português e inglês', () => {
    expect(parseMusicCommand(`/tocar https://youtu.be/${ID}`)).toEqual({ name: 'tocar', arg: `https://youtu.be/${ID}` })
    expect(parseMusicCommand('/pular')).toEqual({ name: 'pular', arg: '' })
    expect(parseMusicCommand('/SKIP')).toEqual({ name: 'pular', arg: '' })
    expect(parseMusicCommand('/continuar')?.name).toBe('continuar')
    expect(parseMusicCommand('/fila')?.name).toBe('fila')
  })
  it('um link solto vira /tocar; texto comum e comando desconhecido não', () => {
    expect(parseMusicCommand(`https://youtu.be/${ID}`)?.name).toBe('tocar')
    expect(parseMusicCommand('bom dia pessoal')).toBeNull()
    expect(parseMusicCommand('/banir fulano')).toBeNull()
    expect(parseMusicCommand(`veja isso aqui nesse vídeo https://youtu.be/${ID} muito bom`)).toBeNull()
  })
})
