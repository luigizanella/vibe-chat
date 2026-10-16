import { useState } from 'react'
import { EMOJI_GROUPS } from '@/lib/emoji'
import { Layer } from '@/components/Layer'

/** Seletor de emojis ancorado em um botão (camada única: vira de lado e fica acima de modais). */
export function EmojiPicker({ anchor, onPick, onClose }: { anchor: DOMRect; onPick: (e: string) => void; onClose: () => void }) {
  const [group, setGroup] = useState(0)
  const list = EMOJI_GROUPS[group].emojis

  return (
    <Layer anchor={anchor} placement="top-end" gap={8} onDismiss={onClose} role="dialog" label="Seletor de emojis">
      <div className="flex h-[340px] w-[min(340px,92vw)] flex-col rounded-lg border border-border bg-[var(--bg-elevated)] shadow-[var(--shadow)]">
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
    </Layer>
  )
}
