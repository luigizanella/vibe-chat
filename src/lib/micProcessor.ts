import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'
import { GateCore, levelFromDb } from '@/lib/gate'

/** Supressão de ruído: nenhuma, a do navegador (constraint do getUserMedia) ou RNNoise (rede neural, local). */
export type NoiseMode = 'off' | 'browser' | 'high'

export interface MicChainOptions {
  mode: NoiseMode
  auto: boolean
  sensitivity: number
}

/** O que realmente está rodando (para diagnóstico na tela de voz). */
export type MicChainStatus = 'starting' | 'rnnoise' | 'gate-only' | 'rnnoise-failed'

let rnnoiseBinary: Promise<ArrayBuffer> | null = null
async function loadBinary(): Promise<ArrayBuffer> {
  rnnoiseBinary ??= (async () => {
    const [{ loadRnnoise }, wasm, simd] = await Promise.all([
      import('@sapphi-red/web-noise-suppressor'),
      import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'),
      import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'),
    ])
    return loadRnnoise({ url: wasm.default, simdUrl: simd.default })
  })().catch((e) => {
    rnnoiseBinary = null
    throw e
  })
  return rnnoiseBinary
}

/**
 * Cadeia de áudio do microfone, usada tanto na chamada (como TrackProcessor da LiveKit — a faixa
 * processada é a que é PUBLICADA) quanto no teste de microfone das configurações:
 *
 *   microfone → passa-alta 90 Hz → [RNNoise] → medidor → porta de ruído (ganho) → saída
 *
 * O medidor lê o sinal DEPOIS do RNNoise, então teclado/ventilador que a rede neural remove não abrem a porta.
 */
export class MicChain implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'vibe-mic-chain'
  processedTrack?: MediaStreamTrack
  readonly core = new GateCore({ auto: true, sensitivity: 35 })
  status: MicChainStatus = 'starting'
  mode: NoiseMode = 'high'
  /** Recebe (nível 0–100, aberto, limite 0–100) ~25x por segundo. */
  onMeter?: (level: number, open: boolean, threshold: number) => void
  onStatus?: (s: MicChainStatus) => void
  private ctx?: AudioContext
  private nodes: AudioNode[] = []
  private timer?: ReturnType<typeof setInterval>
  private ticks = 0

  configure(o: MicChainOptions) {
    this.mode = o.mode
    this.core.opts = { auto: o.auto, sensitivity: o.sensitivity }
  }

  private setStatus(s: MicChainStatus) {
    this.status = s
    this.onStatus?.(s)
  }

  async init(opts: AudioProcessorOptions) {
    // contexto próprio a 48 kHz (o RNNoise exige) — independente do contexto compartilhado da LiveKit
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    this.ctx = ctx
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
    const source = ctx.createMediaStreamSource(new MediaStream([opts.track]))
    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 90
    source.connect(highpass)
    let tail: AudioNode = highpass
    const nodes: AudioNode[] = [source, highpass]
    this.setStatus('starting')

    if (this.mode === 'high') {
      try {
        const [{ RnnoiseWorkletNode }, worklet, wasmBinary] = await Promise.all([
          import('@sapphi-red/web-noise-suppressor'),
          import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'),
          loadBinary(),
        ])
        await ctx.audioWorklet.addModule(worklet.default)
        const rn = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary })
        tail.connect(rn)
        tail = rn
        nodes.push(rn)
        this.setStatus('rnnoise')
      } catch (e) {
        console.warn('RNNoise indisponível, seguindo só com a porta de ruído', (e as Error).message)
        this.setStatus('rnnoise-failed')
      }
    } else {
      this.setStatus('gate-only')
    }

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    const gain = ctx.createGain()
    const dest = ctx.createMediaStreamDestination()
    tail.connect(analyser)
    tail.connect(gain)
    gain.connect(dest)
    nodes.push(analyser, gain)
    this.nodes = nodes
    this.processedTrack = dest.stream.getAudioTracks()[0]
    this.core.reset()

    const buf = new Float32Array(analyser.fftSize)
    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-9)
      const open = this.core.update(db, performance.now())
      // ataque curto (5 ms) para não cortar o começo da palavra; soltura mais suave (60 ms)
      gain.gain.setTargetAtTime(open ? 1 : 0, ctx.currentTime, open ? 0.005 : 0.06)
      if (++this.ticks % 2 === 0) this.onMeter?.(levelFromDb(db), open, levelFromDb(this.core.thresholdDb))
    }, 20)
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy()
    await this.init(opts)
  }

  async destroy() {
    clearInterval(this.timer)
    for (const n of this.nodes) {
      try {
        ;(n as { destroy?: () => void }).destroy?.()
        n.disconnect()
      } catch {
        /* já desconectado */
      }
    }
    this.nodes = []
    this.processedTrack?.stop()
    this.processedTrack = undefined
    const ctx = this.ctx
    this.ctx = undefined
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => undefined)
  }
}

/** Restrições de captura do navegador para cada modo. No modo "Alta", só o RNNoise limpa (evita processar duas vezes). */
export function captureConstraints(mode: NoiseMode, echoCancellation: boolean, autoGainControl: boolean) {
  return { noiseSuppression: mode === 'browser', echoCancellation, autoGainControl }
}
