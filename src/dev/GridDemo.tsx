import { TileGrid, useSize } from '@/components/voice/VoiceStage'
import { MAX_TILES } from '@/lib/grid'

/** Grade da chamada com blocos simulados (só para conferir o layout em desenvolvimento). */
export function GridDemo({ n }: { n: number }) {
  const [ref, size] = useSize<HTMLDivElement>()
  const shown = Math.min(n, MAX_TILES)
  const items = Array.from({ length: shown }, (_, i) => ({
    key: String(i),
    node: (
      <div className="relative grid h-full w-full place-items-center rounded-xl bg-[#2b2d31] text-white">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-[#5865f2] text-xl font-bold">{i + 1}</div>
        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs">pessoa {i + 1}</span>
      </div>
    ),
  }))
  if (n > shown) items[shown - 1] = { key: 'more', node: <div className="grid h-full w-full place-items-center rounded-xl bg-[#2b2d31] text-xl font-bold text-white">+{n - shown + 1}</div> }
  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <div ref={ref} className="min-h-0 flex-1 overflow-hidden p-2"><TileGrid items={items} w={size.w} h={size.h} /></div>
      <div className="h-16 shrink-0 border-t border-white/10 text-center leading-[4rem]">barra de controles ({n} telas)</div>
    </div>
  )
}
