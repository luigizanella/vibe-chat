import { describe, expect, it } from 'vitest'
import { MAX_TILES, bestGrid } from '@/lib/grid'

describe('grade da chamada', () => {
  const sizes: [number, number][] = [[1200, 700], [800, 600], [420, 700], [1920, 900]]
  it.each([1, 2, 3, 4, 5, 6, 9, 12, 16])('%i blocos cabem sem passar da área nem sobrepor', (n) => {
    for (const [w, h] of sizes) {
      const g = bestGrid(n, w, h, 8)
      expect(g.cols * g.rows).toBeGreaterThanOrEqual(n)
      expect(g.cols * g.tw + (g.cols - 1) * 8).toBeLessThanOrEqual(w + 1)
      expect(g.rows * g.th + (g.rows - 1) * 8).toBeLessThanOrEqual(h + 1)
      expect(g.tw).toBeGreaterThan(0)
    }
  })
  it('2 pessoas ficam lado a lado numa tela larga e empilhadas numa estreita', () => {
    expect(bestGrid(2, 1200, 700).cols).toBe(2)
    expect(bestGrid(2, 380, 760).cols).toBe(1)
  })
  it('1 pessoa ocupa quase toda a área; 4 viram 2x2', () => {
    expect(bestGrid(1, 1000, 600).tw).toBeGreaterThan(900)
    const g = bestGrid(4, 1200, 700)
    expect([g.cols, g.rows]).toEqual([2, 2])
  })
  it('limite de blocos', () => expect(MAX_TILES).toBe(16))
})
