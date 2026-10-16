/** Cor de texto (branco ou quase preto) com melhor contraste sobre a cor de destaque. */
export function contrastColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.0575 ? '#ffffff' : '#0b0b0d'
}



export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function relLum([r, g, b]: number[]): number {
  const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrastRatio(a: string, b: string): number {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (!ra || !rb) return 21
  const [hi, lo] = [relLum(ra), relLum(rb)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Ajusta a cor (de cargo, por exemplo) para ter contraste mínimo contra o fundo, clareando em fundos
 * escuros e escurecendo em fundos claros, preservando o matiz. O valor salvo não muda; só a exibição.
 */
export function readableColor(color: string, background: string, min = 4.5): string {
  const rgb = hexToRgb(color)
  const bg = hexToRgb(background)
  if (!rgb || !bg) return color
  if (contrastRatio(color, background) >= min) return color
  const lighten = relLum(bg) < 0.4
  let [r, g, b] = rgb
  for (let i = 0; i < 40; i++) {
    // mistura gradualmente com branco (fundo escuro) ou preto (fundo claro)
    const target = lighten ? 255 : 0
    r += (target - r) * 0.1
    g += (target - g) * 0.1
    b += (target - b) * 0.1
    const hex = rgbToHex(r, g, b)
    if (contrastRatio(hex, background) >= min) return hex
  }
  return lighten ? '#ffffff' : '#000000'
}