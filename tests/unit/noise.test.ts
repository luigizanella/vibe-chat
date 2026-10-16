// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { captureConstraints } from '@/lib/micProcessor'
import { GateCore, dbFromLevel } from '@/lib/gate'

describe('supressão de ruído', () => {
  it('padrão é RNNoise ("Alta") e o navegador não processa em dobro', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }))
    const { DEFAULT_SETTINGS } = await import('@/store/settings')
    expect(DEFAULT_SETTINGS.voice.noiseMode).toBe('high')
    expect(captureConstraints('high', true, true).noiseSuppression).toBe(false)
    expect(captureConstraints('browser', true, true).noiseSuppression).toBe(true)
    expect(captureConstraints('off', true, false)).toEqual({ noiseSuppression: false, echoCancellation: true, autoGainControl: false })
  })

  it('sensibilidade manual no máximo silencia digitação alta; em 0 deixa tudo passar', () => {
    const typing = -28 // clique de teclado perto do microfone (dBFS)
    const g = new GateCore({ auto: false, sensitivity: 100 })
    expect(dbFromLevel(100)).toBe(-20)
    let open = false
    for (let i = 0; i < 100; i++) open = g.update(typing, i * 20)
    expect(open).toBe(false)
    const off = new GateCore({ auto: false, sensitivity: 0 })
    expect(off.update(-90, 0)).toBe(true)
  })
})
