import { RefreshCw } from 'lucide-react'
import { useUpdate } from '@/lib/updater'
import { useVoice } from '@/store/voice'

/** Aviso discreto: só aparece quando há atualização pronta e você está numa chamada (senão ela se aplica sozinha). */
export function UpdateBanner() {
  const { status, version, applyNow } = useUpdate()
  const inCall = useVoice((s) => s.status !== 'idle')
  if (status !== 'ready' || !inCall) return null
  return (
    <div className="fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-[var(--bg-elevated)] px-4 py-2 text-sm shadow-[var(--shadow)]" role="status">
      <span>Atualização{version ? ` ${version}` : ''} pronta. Será aplicada quando a chamada terminar.</span>
      <button className="btn btn-primary btn-sm" onClick={applyNow}><RefreshCw size={13} /> Reiniciar agora</button>
    </div>
  )
}
