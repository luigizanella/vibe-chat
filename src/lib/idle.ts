import { create } from 'zustand'
import { isTauri } from './env'

/** Estado "ausente por inatividade" (vira status Ausente e, em chamada, move para o canal de ausentes). */
export const useAfk = create<{ active: boolean }>(() => ({ active: false }))

let last = Date.now()
let started = false

/** Registra atividade do usuário (mouse, teclado, toque, foco). Usa carimbo de tempo: timers em aba de fundo são limitados pelo navegador. */
export function startIdleTracking() {
  if (started) return
  started = true
  const bump = () => {
    last = Date.now()
  }
  for (const e of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'pointerdown', 'focus']) window.addEventListener(e, bump, { passive: true })
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && bump())
}

/**
 * Segundos de ociosidade. No app desktop vale o tempo ocioso REAL do sistema (qualquer programa); no navegador,
 * o tempo desde a última atividade registrada nesta página (sem permissões extras).
 */
export async function idleSeconds(): Promise<number> {
  if (isTauri) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<number>('idle_seconds')
    } catch {
      /* sem suporte no sistema: cai no cálculo do navegador */
    }
  }
  return (Date.now() - last) / 1000
}
