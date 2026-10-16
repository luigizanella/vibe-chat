import { useState } from 'react'
import clsx from 'clsx'
import { Monitor } from 'lucide-react'
import { Modal, Toggle, useCloseModal } from '@/components/ui'
import { useSettings } from '@/store/settings'
import { useVoice } from '@/store/voice'
import { acquireScreenStream, screenPreset } from '@/lib/screen'
import { isMac, isSafari } from '@/lib/diag'
import { useUI } from '@/store/ui'

function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; l: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <label id={`ch-${label}`}>{label}</label>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby={`ch-${label}`}>
        {options.map((o) => (
          <button key={String(o.v)} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} className={clsx('rounded-md border p-3 text-left', value === o.v ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-border bg-secondary hover:bg-[var(--bg-hover)]')}>
            <span className="block font-semibold">{o.l}</span>
            {o.hint && <span className="text-xs text-fg-muted">{o.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function ScreenShareModal() {
  const close = useCloseModal()
  const v = useSettings((s) => s.settings.voice)
  const updateVoice = useSettings((s) => s.updateVoice)
  const toggleScreen = useVoice((s) => s.toggleScreen)
  const [q, setQ] = useState<'720p' | '1080p'>(screenPreset(v.screenQuality, v.screenFps).quality)
  const [fps, setFps] = useState<30 | 60>(screenPreset(v.screenQuality, v.screenFps).fps)
  const [audio, setAudio] = useState(v.screenAudio)
  const p = screenPreset(q, fps)
  const mbps = (p.maxBitrate / 1_000_000).toFixed(1)

  const start = () => {
    // 1) PRIMEIRO pede a captura, direto do clique (o Safari exige o gesto do usuário e não tolera etapas antes)
    const pending = acquireScreenStream(q, fps, audio)
    pending.catch(() => undefined) // o erro é tratado em toggleScreen
    updateVoice({ screenQuality: q, screenFps: fps, screenAudio: audio })
    close()
    void toggleScreen(pending)
  }

  return (
    <Modal
      title="Compartilhar tela"
      description="Depois de confirmar, o seu sistema pede para escolher a tela inteira, uma janela ou uma aba. Nada é capturado antes disso."
      footer={<><button className="btn btn-ghost" onClick={close}>Cancelar</button><button className="btn btn-primary" onClick={start} autoFocus><Monitor size={16} /> Escolher o que compartilhar</button></>}
    >
      <div className="flex flex-col gap-4">
        <Choice label="Resolução" value={q} onChange={setQ} options={[{ v: '720p', l: '720p', hint: 'Mais leve' }, { v: '1080p', l: '1080p', hint: 'Mais nítida' }]} />
        <Choice label="Quadros por segundo" value={fps} onChange={setFps} options={[{ v: 30, l: '30 fps', hint: 'Texto, apresentações' }, { v: 60, l: '60 fps', hint: 'Jogos e vídeos' }]} />
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold">Compartilhar áudio do sistema</div>
            <div className="text-xs text-fg-muted">Funciona ao escolher “tela inteira” ou “aba” no Chrome/Edge (Windows). Se o sistema não entregar o áudio, você é avisado.</div>
          </div>
          <Toggle checked={audio} onChange={setAudio} label="Compartilhar áudio do sistema" />
        </div>
        {isMac() && (
          <div className="rounded-md border border-border bg-secondary p-3 text-sm text-fg-2">
            <strong className="text-fg">No Mac:</strong> se o seletor não abrir ou a imagem ficar preta, libere o navegador em Ajustes do Sistema, Privacidade e Segurança, Gravação de Tela, e reinicie o navegador.{isSafari() && ' O Safari não compartilha o áudio do sistema.'}
          </div>
        )}
        <p className="hint m-0">Até {mbps} Mbps por espectador. {q === '1080p' && fps === 60 ? 'A combinação 1080p/60 usa muita banda: o plano grátis do LiveKit inclui 50 GB/mês no total.' : 'O app reduz a qualidade sozinho se a conexão de alguém não aguentar.'}</p>
      </div>
    </Modal>
  )
}

/** Inicia (abre o menu de qualidade) ou encerra o compartilhamento de tela. */
export function requestScreenShare() {
  const { screenOn, toggleScreen } = useVoice.getState()
  if (screenOn) void toggleScreen()
  else useUI.getState().openModal(<ScreenShareModal />)
}
