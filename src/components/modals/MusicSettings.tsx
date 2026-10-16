import { useQueryClient } from '@tanstack/react-query'
import { Music } from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import type { PermContext } from '@/lib/perms'
import { qk, useChannels, useMembers } from '@/data/queries'
import { MUSIC_HELP } from '@/data/music'
import { Avatar, Toggle, useAction } from '@/components/ui'
import { toast } from '@/store/ui'

export function MusicSettings({ ctx }: { ctx: PermContext }) {
  const qc = useQueryClient()
  const sid = ctx.server.id
  const { data: members } = useMembers(sid)
  const { data: channels } = useChannels(sid)
  const { busy, run } = useAction()
  const botOn = !!members?.some((m) => m.profile?.is_bot)
  const texts = (channels ?? []).filter((c) => c.kind === 'text')

  const toggleBot = (v: boolean) =>
    run(async () => {
      await rpc('set_music_bot', { p_server: sid, p_enabled: v })
      await qc.invalidateQueries({ queryKey: qk.members(sid) })
      toast.success(v ? 'Vibe Beats ligado.' : 'Vibe Beats desligado e fila apagada.')
    })

  const setChannel = async (id: string) => {
    try {
      await rpc('set_music_channel', { p_server: sid, p_channel: id || null })
      await qc.invalidateQueries({ queryKey: qk.servers })
      toast.success(id ? 'Canal de comandos definido.' : 'Canal de comandos removido.')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="max-w-xl">
      <h2 className="mt-0 mb-5 text-xl font-bold">Música (Vibe Beats)</h2>
      <div className="card mb-5 flex items-center gap-3">
        <Avatar path="app:logo" name="Vibe Beats" id="vibe-beats" size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-semibold">Vibe Beats <span className="rounded bg-[var(--accent)] px-1 text-[10px] leading-4 text-[var(--accent-contrast)]">APP</span></div>
          <div className="text-xs text-fg-muted">Toca links do YouTube na chamada. Cada pessoa ouve pelo player oficial do YouTube; nada é baixado nem passa por servidor próprio.</div>
        </div>
        <Toggle checked={botOn} disabled={busy} onChange={(v) => void toggleBot(v)} label="Ligar o bot Vibe Beats" />
      </div>

      <div className="field mb-5">
        <label htmlFor="music-ch">Canal de comandos</label>
        <select id="music-ch" className="select" disabled={!botOn} value={ctx.server.music_channel_id ?? ''} onChange={(e) => void setChannel(e.target.value)}>
          <option value="">Nenhum (usar só o painel da chamada)</option>
          {texts.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </select>
        <span className="hint">Neste canal de texto, quem estiver numa chamada digita comandos e o bot responde ali. Sem canal definido, use o botão de música na tela da chamada.</span>
      </div>

      <h3 className="mt-0 flex items-center gap-2"><Music size={16} /> Como usar</h3>
      <ul className="m-0 pl-5 text-fg-2">
        <li>{MUSIC_HELP}</li>
        <li>Na chamada: botão de música abre a fila; qualquer pessoa na chamada pode adicionar, pular, pausar e parar.</li>
        <li>O volume do bot é individual (cada um ajusta o seu).</li>
        <li>Vídeos que o dono não permite incorporar são pulados com aviso.</li>
      </ul>
    </div>
  )
}
