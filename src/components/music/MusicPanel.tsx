import { useState } from 'react'
import { ListMusic, Pause, Play, Plus, SkipBack, SkipForward, Square, Trash2, X } from 'lucide-react'
import { addMusic, controlMusic, removeFromQueue, useMusic, MUSIC_HELP } from '@/data/music'
import { useMembers } from '@/data/queries'
import { thumbUrl } from '@/lib/youtube'
import { Avatar, EmptyState, Spinner } from '@/components/ui'

/** Painel de música da chamada: adicionar link, controles e fila (qualquer pessoa na chamada pode usar). */
export function MusicPanel({ channelId, serverId, onClose }: { channelId: string; serverId: string; onClose: () => void }) {
  const { data, isLoading } = useMusic(channelId)
  const { data: members } = useMembers(serverId)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const s = data?.session
  const queue = data?.queue ?? []
  const who = (id: string | null) => (id ? members?.find((m) => m.user_id === id)?.profile?.display_name ?? 'alguém' : '')
  const playing = s?.status === 'playing'
  const idle = !s || s.status === 'idle'

  const add = async () => {
    if (!link.trim() || busy) return
    setBusy(true)
    const ok = await addMusic(channelId, link)
    setBusy(false)
    if (ok) setLink('')
  }

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-l border-border bg-[var(--bg-secondary)] md:w-80" aria-label="Música da chamada">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3 font-bold">
        <span className="flex items-center gap-2"><ListMusic size={18} /> Vibe Beats <span className="rounded bg-[var(--accent)] px-1 text-[10px] text-[var(--accent-contrast)]">APP</span></span>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar painel de música"><X size={18} /></button>
      </header>

      <div className="border-b border-border p-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <input className="input" placeholder="Cole um link do YouTube" aria-label="Link do YouTube" value={link} onChange={(e) => setLink(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !link.trim()} aria-label="Adicionar à fila">{busy ? <Spinner size={14} /> : <Plus size={16} />}</button>
        </form>
        <p className="hint mt-2 mb-0">{MUSIC_HELP}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading ? <Spinner /> : (
          <>
            <div className="label mb-2">Tocando agora</div>
            {idle ? (
              <p className="mt-0 text-fg-muted">Nada tocando. Cole um link acima para começar.</p>
            ) : (
              <div className="mb-4 rounded-md bg-[var(--bg-primary)] p-2">
                <div className="flex gap-2">
                  <img src={thumbUrl(s!.video_id!)} alt="" className="h-12 w-20 shrink-0 rounded object-cover" loading="lazy" />
                  <div className="min-w-0">
                    <div className="line-clamp-2 font-semibold" title={s!.title ?? ''}>{s!.title}</div>
                    <div className="text-xs text-fg-muted">pedido por {who(s!.added_by) || '—'}{s!.status === 'paused' ? ' · pausada' : ''}</div>
                  </div>
                </div>
                <div className="mt-2 flex gap-1">
                  <button className="icon-btn" aria-label="Voltar" data-tip="Voltar" onClick={() => void controlMusic(channelId, 'back')}><SkipBack size={16} /></button>
                  <button className="icon-btn" aria-label={playing ? 'Pausar' : 'Continuar'} data-tip={playing ? 'Pausar' : 'Continuar'} onClick={() => void controlMusic(channelId, playing ? 'pause' : 'resume')}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
                  <button className="icon-btn" aria-label="Pular" data-tip="Pular" onClick={() => void controlMusic(channelId, 'skip')}><SkipForward size={16} /></button>
                  <button className="icon-btn" aria-label="Parar e limpar a fila" data-tip="Parar e limpar" onClick={() => void controlMusic(channelId, 'stop')}><Square size={14} /></button>
                </div>
              </div>
            )}

            <div className="label mb-2">Fila ({queue.length}/50)</div>
            {!queue.length ? <EmptyState title="Fila vazia">Adicione mais músicas com um link do YouTube.</EmptyState> : (
              <ol className="m-0 list-none p-0">
                {queue.map((q, i) => (
                  <li key={q.id} className="group flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-[var(--bg-hover)]">
                    <span className="w-5 shrink-0 text-center text-xs text-fg-muted">{i + 1}</span>
                    <img src={thumbUrl(q.video_id)} alt="" className="h-8 w-14 shrink-0 rounded object-cover" loading="lazy" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" title={q.title}>{q.title}</div>
                      <div className="flex items-center gap-1 truncate text-xs text-fg-muted">{q.added_by && <Avatar path={members?.find((m) => m.user_id === q.added_by)?.profile?.avatar_path} name={who(q.added_by)} id={q.added_by} size={14} />}{who(q.added_by)}</div>
                    </div>
                    <button className="icon-btn h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Remover ${q.title} da fila`} data-tip="Remover" onClick={() => void removeFromQueue(channelId, q.id)}><Trash2 size={14} /></button>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
