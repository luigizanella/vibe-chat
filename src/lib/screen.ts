/** Qualidade válida mesmo se um valor antigo (ex.: 1440p/15 fps) estiver salvo. */
export function screenPreset(q: string, fps: number) {
  const quality: '720p' | '1080p' = q === '720p' ? '720p' : '1080p'
  const rate = fps === 60 ? 60 : 30
  const [width, height] = quality === '720p' ? [1280, 720] : [1920, 1080]
  // taxa máxima de bits por combinação (kbps → bps); 1080p60 é o mais pesado
  const kbps = { '720p': { 30: 2500, 60: 4000 }, '1080p': { 30: 4500, 60: 7000 } }[quality][rate]
  return { quality, fps: rate as 30 | 60, resolution: { width, height, frameRate: rate }, maxBitrate: kbps * 1000 }
}

import { isSafari } from './diag'

export interface ScreenAcquire {
  stream: MediaStream
  /** Segundos até a resposta: respostas instantâneas de erro indicam bloqueio do sistema (nem abriu o seletor). */
  ms: number
}

/**
 * Pede a captura de tela. DEVE ser chamada direto do clique (sem await antes): o Safari exige o "gesto do usuário"
 * e recusa em silêncio se houver qualquer etapa assíncrona antes. Tenta restrições ricas e cai para o mínimo.
 */
export function acquireScreenStream(quality: string, fps: number, audio: boolean): Promise<ScreenAcquire> {
  const md = navigator.mediaDevices
  if (!md?.getDisplayMedia) return Promise.reject(Object.assign(new Error('getDisplayMedia indisponível'), { name: 'NotSupportedError' }))
  const p = screenPreset(quality, fps)
  const t0 = performance.now()
  const done = (stream: MediaStream): ScreenAcquire => ({ stream, ms: performance.now() - t0 })
  const fail = (e: unknown) => {
    ;(e as { ms?: number }).ms = performance.now() - t0
    throw e
  }
  // Safari/WebKit: só o básico (não aceita as opções extras e não entrega áudio do sistema)
  if (isSafari()) return md.getDisplayMedia({ video: true }).then(done, fail)
  const rich = {
    video: { width: { ideal: p.resolution.width }, height: { ideal: p.resolution.height }, frameRate: { ideal: p.fps } },
    audio,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: audio ? 'include' : 'exclude',
  } as unknown as DisplayMediaStreamOptions
  return md.getDisplayMedia(rich).then(done, (e: unknown) => {
    const name = (e as { name?: string })?.name
    // restrição não suportada: tenta o mínimo (ainda dentro do mesmo gesto)
    if (name === 'TypeError' || name === 'OverconstrainedError' || name === 'NotSupportedError') return md.getDisplayMedia({ video: true }).then(done, fail)
    return fail(e)
  })
}