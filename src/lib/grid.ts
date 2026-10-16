/** Melhor encaixe de N telas numa área: maximiza o tamanho dos blocos sem sobrepor nem rolar. */
export interface GridFit {
  cols: number
  rows: number
  tw: number
  th: number
}

const MIN_ASPECT = 1.2 // quase 4:3
const MAX_ASPECT = 1.9 // um pouco mais largo que 16:9

export function bestGrid(n: number, w: number, h: number, gap = 8): GridFit {
  if (n <= 0 || w <= 0 || h <= 0) return { cols: 1, rows: 1, tw: 0, th: 0 }
  let best: GridFit & { area: number } = { cols: 1, rows: n, tw: 0, th: 0, area: -1 }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    let tw = (w - gap * (cols - 1)) / cols
    let th = (h - gap * (rows - 1)) / rows
    if (tw <= 0 || th <= 0) continue
    if (tw / th > MAX_ASPECT) tw = th * MAX_ASPECT
    else if (tw / th < MIN_ASPECT) th = tw / MIN_ASPECT
    const area = tw * th
    if (area > best.area + 0.5) best = { cols, rows, tw: Math.floor(tw), th: Math.floor(th), area }
  }
  return { cols: best.cols, rows: best.rows, tw: best.tw, th: best.th }
}

/** Máximo de blocos exibidos na grade; o resto vira "+N". */
export const MAX_TILES = 16
