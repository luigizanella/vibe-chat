import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { contrastColor, contrastRatio, readableColor } from '@/lib/color'

/**
 * Garante contraste WCAG AA (≥ 4,5:1 texto / ≥ 3:1 componentes) nos pares de cores dos tokens
 * definidos em src/styles/theme.css, para os temas escuro e claro e a área de chamada.
 */
const css = readFileSync('src/styles/theme.css', 'utf8')

function block(selectorRe: RegExp): Record<string, string> {
  const m = selectorRe.exec(css)
  if (!m) throw new Error(`bloco não encontrado: ${selectorRe}`)
  const body = css.slice(m.index + m[0].length, css.indexOf('\n}', m.index))
  const out: Record<string, string> = {}
  for (const [, k, v] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[k] = v.trim()
  return out
}

const root = block(/:root\s*\{/)
const dark = { ...root, ...block(/:root,\s*\n\[data-theme='dark'\]\s*\{/) }
const light = { ...root, ...block(/\[data-theme='light'\]\s*\{/) }
const stage = { ...dark, ...block(/\.stage-dark\s*\{/) }

function hex(v: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(v)
  if (!m) throw new Error(`cor inválida: ${v}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: string, b: string) => {
  const [l1, l2] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

const surfaces = ['bg-rail', 'bg-tertiary', 'bg-secondary', 'bg-primary', 'bg-elevated']

describe.each([
  ['escuro', dark],
  ['claro', light],
])('contraste AA — tema %s', (_n, t) => {
  it.each(['text-primary', 'text-secondary', 'text-muted'])('%s legível sobre as superfícies', (tok) => {
    for (const s of surfaces) expect(ratio(t[tok], t[s]), `${tok} sobre ${s}`).toBeGreaterThanOrEqual(4.5)
  })
  it('link, sucesso, perigo e aviso (como texto) sobre fundo principal e secundário', () => {
    for (const tok of ['text-link', 'success-text', 'danger-text', 'warning-text'])
      for (const s of ['bg-primary', 'bg-secondary'])
        expect(ratio(t[tok], t[s]), `${tok} sobre ${s}`).toBeGreaterThanOrEqual(4.5)
  })
  it('texto branco sobre perigo e sucesso (botões/selos)', () => {
    expect(ratio('#ffffff', t.danger)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('contraste AA — área de chamada (sempre escura)', () => {
  it('texto sobre as superfícies da chamada', () => {
    for (const tok of ['text-primary', 'text-secondary', 'text-muted'])
      for (const s of ['bg-primary', 'bg-secondary', 'bg-rail']) expect(ratio(stage[tok], stage[s]), `${tok} sobre ${s}`).toBeGreaterThanOrEqual(4.5)
  })
})

describe('cor de destaque', () => {
  it('o texto sobre o destaque padrão e as predefinições tem AA (≥ 4,5:1)', () => {
    for (const accent of ['#6b5bff', '#2f7de1', '#1f8f55', '#c98a00', '#d9531e', '#d63a3d', '#c2398f', '#0e9aa7']) {
      const fg = contrastColor(accent)
      expect(ratio(fg === '#ffffff' ? '#ffffff' : '#0b0b0d', accent), accent).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('cores de cargo legíveis', () => {
  it('clareia/escurece cores de cargo até AA preservando as que já passam', () => {
    for (const [bg, fgs] of [['#2b2d31', ['#000000', '#1a1a80', '#3b3bff', '#99aab5', '#ffffff']], ['#ffffff', ['#ffff00', '#f0f0f0', '#99aab5', '#000000', '#ed4245']]] as const)
      for (const c of fgs) expect(contrastRatio(readableColor(c, bg), bg), `${c} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
    expect(readableColor('#ffffff', '#2b2d31')).toBe('#ffffff')
  })
})