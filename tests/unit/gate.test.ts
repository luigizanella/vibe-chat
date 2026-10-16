import { describe, expect, it } from 'vitest'
import { DB_MAX, DB_MIN, GateCore, dbFromLevel, levelFromDb } from '@/lib/gate'

/** Simula N amostras de 20 ms com o nível dado e retorna se terminou aberto. */
function feed(g: GateCore, db: number, ms: number, t0: number): { open: boolean; t: number } {
  let t = t0
  let open = g.open
  for (let i = 0; i < ms / 20; i++) {
    t += 20
    open = g.update(db, t)
  }
  return { open, t }
}

describe('escala do medidor', () => {
  it('mapeia dBFS ↔ 0–100 de forma reversível', () => {
    expect(levelFromDb(DB_MIN)).toBe(0)
    expect(levelFromDb(DB_MAX)).toBe(100)
    expect(levelFromDb(-200)).toBe(0)
    expect(levelFromDb(0)).toBe(100)
    for (const l of [0, 25, 50, 75, 100]) expect(levelFromDb(dbFromLevel(l))).toBeCloseTo(l, 5)
  })
})

describe('gate manual', () => {
  it('sensibilidade 0 deixa tudo passar', () => {
    const g = new GateCore({ auto: false, sensitivity: 0 })
    expect(feed(g, -90, 1000, 0).open).toBe(true)
  })
  it('bloqueia ruído abaixo do limite e abre com fala acima dele', () => {
    const g = new GateCore({ auto: false, sensitivity: 60 }) // limite = −44 dBFS
    let r = feed(g, -55, 1000, 0) // ruído de fundo
    expect(r.open).toBe(false)
    r = feed(g, -25, 200, r.t) // fala
    expect(r.open).toBe(true)
  })
  it('mantém aberto durante a retenção e fecha depois', () => {
    const g = new GateCore({ auto: false, sensitivity: 60 })
    let r = feed(g, -25, 200, 0)
    r = feed(g, -70, 200, r.t) // 200 ms de silêncio (< 300 ms de retenção)
    expect(r.open).toBe(true)
    r = feed(g, -70, 600, r.t)
    expect(r.open).toBe(false)
  })
  it('o slider muda o limite em tempo real', () => {
    const g = new GateCore({ auto: false, sensitivity: 20 })
    expect(feed(g, -50, 1000, 0).open).toBe(true) // -50 > limite(-68)
    g.opts.sensitivity = 80 // limite −32
    g.reset()
    expect(feed(g, -50, 1000, 0).open).toBe(false)
  })
})

describe('gate automático', () => {
  it('aprende o ruído de fundo constante e o ignora', () => {
    const g = new GateCore({ auto: true, sensitivity: 0 })
    const r = feed(g, -52, 4000, 0) // ventilador/ruído estável
    expect(r.open).toBe(false)
    expect(g.noiseFloorDb).toBeCloseTo(-52, 0)
  })
  it('abre com fala bem acima do piso e fecha de novo depois', () => {
    const g = new GateCore({ auto: true, sensitivity: 0 })
    let r = feed(g, -55, 3000, 0)
    r = feed(g, -28, 400, r.t)
    expect(r.open).toBe(true)
    r = feed(g, -55, 1000, r.t)
    expect(r.open).toBe(false)
  })
  it('em sala silenciosa mantém o limite mínimo (não abre com ruído digital)', () => {
    const g = new GateCore({ auto: true, sensitivity: 0 })
    const r = feed(g, -90, 3000, 0)
    expect(r.open).toBe(false)
    expect(g.thresholdDb).toBe(-65)
  })
  it('não deixa o limite subir demais (fala baixa continua passando)', () => {
    const g = new GateCore({ auto: true, sensitivity: 0 })
    feed(g, -20, 5000, 0) // barulho alto contínuo
    expect(g.thresholdDb).toBeLessThanOrEqual(-32)
  })
})
