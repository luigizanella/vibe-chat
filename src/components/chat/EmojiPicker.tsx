import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EMOJI_GROUPS } from '@/lib/emoji'

/** Seletor de emojis (popover) ancorado em um elemento. */
export function EmojiPicker({ anchor, onPick, onClose }: { anchor: DOMRect; onPick: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [group, setGroup] = useState(0)
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.top })

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(anchor.right - r.width, window.innerWidth - r.width - 8))
    const top = anchor.top - r.height - 8 < 8 ? anchor.bottom + 8 : anchor.top - r.height - 8
    setPos({ left, top })
  }, [anchor])

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const list = EMOJI_GROUPS[group].emojis

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Seletor de emojis"
      className="fixed flex h-[340px] w-[min(340px,92vw)] flex-col rounded-lg border border-border bg-[var(--bg-elevated)] shadow-[var(--shadow)]"
      style={{ left: pos.left, top: pos.top, zIndex: 'var(--z-menu)' as unknown as number, animation: 'pop-in var(--dur-fast) var(--ease)' }}
    >
      <div className="p-2">
        <div className="flex gap-1" role="tablist">
          {EMOJI_GROUPS.map((g, i) => (
            <button key={g.name} role="tab" aria-selected={i === group} aria-label={g.name} data-tip={g.name} className={`icon-btn flex-1 ${i === group ? 'active' : ''}`} onClick={() => setGroup(i)}>
              {g.icon}
            </button>
          ))}
        </div>
      </div>
      <div className="grid flex-1 grid-cols-8 content-start gap-0.5 overflow-y-auto px-2 pb-2">
        {list.map((e) => (
          <button key={e} className="grid h-9 place-items-center rounded border-0 bg-transparent text-xl hover:bg-[var(--bg-hover)]" onClick={() => onPick(e)} aria-label={e}>
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}
