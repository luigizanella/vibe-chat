// Gera o ícone-fonte (1024x1024 PNG) do app sem dependências externas.
// Uso: node scripts/make-icon.mjs && npx tauri icon src-tauri/app-icon.png
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const N = 1024
const px = Buffer.alloc(N * N * 4)

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
const inTriangle = (x, y, [ax, ay], [bx, by], [cx, cy]) => {
  const d = (px1, py1, px2, py2, px3, py3) => (px1 - px3) * (py2 - py3) - (px2 - px3) * (py1 - py3)
  const d1 = d(x, y, ax, ay, bx, by), d2 = d(x, y, bx, by, cx, cy), d3 = d(x, y, cx, cy, ax, ay)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4
    let c = [0, 0, 0, 0]
    if (inRoundRect(x, y, 0, 0, N - 1, N - 1, 230)) c = [124, 108, 255, 255] // fundo (accent)
    const bubble =
      inRoundRect(x, y, 230, 250, 794, 640, 90) || inTriangle(x, y, [380, 600], [380, 790], [560, 640])
    if (bubble && c[3]) c = [255, 255, 255, 255]
    if (inCircle(x, y, 400, 440, 48) || inCircle(x, y, 624, 440, 48)) c = [124, 108, 255, 255]
    px.set(c, i)
  }
}

// PNG mínimo (RGBA, 8 bits)
const raw = Buffer.alloc((N * 4 + 1) * N)
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0
  px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4)
}
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crcb = Buffer.alloc(4)
  crcb.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, crcb])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0)
ihdr.writeUInt32BE(N, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
mkdirSync('src-tauri', { recursive: true })
writeFileSync('src-tauri/app-icon.png', png)
console.log('src-tauri/app-icon.png gerado', png.length, 'bytes')
