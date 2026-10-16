// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireScreenStream } from '@/lib/screen'

const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function setup(ua: string, impl: (o: unknown) => Promise<MediaStream>) {
  vi.stubGlobal('navigator', { userAgent: ua, platform: 'MacIntel', mediaDevices: { getDisplayMedia: vi.fn(impl) } })
  return (navigator.mediaDevices.getDisplayMedia as unknown as ReturnType<typeof vi.fn>)
}
afterEach(() => vi.unstubAllGlobals())

describe('captura de tela', () => {
  it('Safari: pede só {video:true}, uma única vez, direto (gesto do usuário)', async () => {
    const gdm = setup(SAFARI, async () => ({}) as MediaStream)
    const p = acquireScreenStream('1080p', 60, true)
    expect(gdm).toHaveBeenCalledTimes(1) // chamado de forma síncrona, antes de qualquer await
    expect(gdm).toHaveBeenCalledWith({ video: true })
    await p
  })
  it('Chrome: restrições ricas e, se der TypeError, cai para o mínimo', async () => {
    let n = 0
    const gdm = setup(CHROME, async () => {
      if (n++ === 0) throw Object.assign(new Error('x'), { name: 'TypeError' })
      return {} as MediaStream
    })
    await acquireScreenStream('720p', 30, false)
    expect(gdm).toHaveBeenCalledTimes(2)
    expect(gdm.mock.calls[1][0]).toEqual({ video: true })
  })
  it('erro de permissão informa em quantos ms falhou (bloqueio do sistema x cancelou)', async () => {
    setup(CHROME, async () => { throw Object.assign(new Error('Permission denied by system'), { name: 'NotAllowedError' }) })
    await expect(acquireScreenStream('720p', 30, false)).rejects.toMatchObject({ name: 'NotAllowedError', ms: expect.any(Number) })
  })
})
