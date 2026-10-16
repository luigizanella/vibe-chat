// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { screenPreset } from '@/lib/screen'
import { classifyMediaError, permissionSteps } from '@/lib/mediaErrors'

describe('qualidade do compartilhamento de tela', () => {
  it('aplica resolução, fps e bitrate de verdade', () => {
    const a = screenPreset('720p', 30)
    expect(a.resolution).toEqual({ width: 1280, height: 720, frameRate: 30 })
    expect(a.maxBitrate).toBe(2_500_000)
    const b = screenPreset('1080p', 60)
    expect(b.resolution).toEqual({ width: 1920, height: 1080, frameRate: 60 })
    expect(b.maxBitrate).toBe(7_000_000)
    expect(screenPreset('1080p', 30).maxBitrate).toBeLessThan(b.maxBitrate)
  })
  it('valores antigos salvos (1440p/15 fps) caem em uma combinação válida', () => {
    const p = screenPreset('1440p', 15)
    expect(p.quality).toBe('1080p')
    expect(p.fps).toBe(30)
  })
})

describe('erros de mídia', () => {
  it('classifica os erros do navegador', () => {
    const e = (name: string) => Object.assign(new Error('x'), { name })
    expect(classifyMediaError(e('NotAllowedError'))).toBe('denied')
    expect(classifyMediaError(e('NotFoundError'))).toBe('notfound')
    expect(classifyMediaError(e('NotReadableError'))).toBe('busy')
    expect(classifyMediaError(e('OverconstrainedError'))).toBe('overconstrained')
    expect(classifyMediaError(new Error('Permission denied by system'))).toBe('denied')
    expect(classifyMediaError(new Error('?'))).toBe('other')
  })
  it('passos para liberar existem para microfone, câmera e tela', () => {
    for (const k of ['microphone', 'camera', 'screen'] as const) expect(permissionSteps(k).length).toBeGreaterThanOrEqual(2)
    expect(permissionSteps('camera').join(' ')).toMatch(/câmera/i)
  })
})
