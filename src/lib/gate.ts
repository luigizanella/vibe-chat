/**
 * Porta de ruído (noise gate) do microfone — lógica pura, compartilhada pelo processador de áudio da
 * chamada e pelo teste de microfone das configurações, e testada sem navegador.
 *
 * Escala do medidor/slider: 0–100 mapeia −80 dBFS … −20 dBFS. Fala normal fica ~65–95; ruído de
 * fundo de ambiente costuma ficar em ~25–50.
 */
export const DB_MIN = -80
export const DB_MAX = -20

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const levelFromDb = (db: number) => clamp(((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100, 0, 100)
export const dbFromLevel = (level: number) => DB_MIN + (clamp(level, 0, 100) / 100) * (DB_MAX - DB_MIN)

export interface GateOptions {
  /** Automático: aprende o ruído de fundo e abre só acima dele. */
  auto: boolean
  /** Manual: 0 (sempre aberto) – 100 (só sons muito altos). */
  sensitivity: number
}

export class GateCore {
  open = false
  thresholdDb = -60
  private samples: number[] = []
  private holdUntil = 0

  constructor(
    public opts: GateOptions,
    private readonly windowSize = 150, // ~3 s a 20 ms por amostra
    private readonly holdMs = 300,
    private readonly autoMarginDb = 12,
  ) {}

  /** Piso de ruído estimado: percentil 20 das últimas amostras. */
  get noiseFloorDb(): number {
    if (!this.samples.length) return -80
    const sorted = [...this.samples].sort((a, b) => a - b)
    return sorted[Math.floor((sorted.length - 1) * 0.2)]
  }

  /** Processa uma amostra de nível (dBFS) no instante `nowMs`; retorna se o gate está aberto. */
  update(db: number, nowMs: number): boolean {
    db = clamp(Number.isFinite(db) ? db : -100, -100, 0)
    this.samples.push(db)
    if (this.samples.length > this.windowSize) this.samples.shift()

    if (!this.opts.auto && this.opts.sensitivity <= 0) {
      this.thresholdDb = DB_MIN
      return (this.open = true)
    }
    this.thresholdDb = this.opts.auto ? clamp(this.noiseFloorDb + this.autoMarginDb, -65, -32) : dbFromLevel(this.opts.sensitivity)

    if (db >= this.thresholdDb) {
      this.open = true
      this.holdUntil = nowMs + this.holdMs
    } else if (this.open && nowMs > this.holdUntil && db < this.thresholdDb - 3) {
      this.open = false
    }
    return this.open
  }

  reset() {
    this.samples = []
    this.open = false
    this.holdUntil = 0
  }
}
