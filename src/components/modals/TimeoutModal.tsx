import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { rpc } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { qk } from '@/data/queries'
import { Modal, Spinner, useCloseModal } from '@/components/ui'
import { toast } from '@/store/ui'

const DURATIONS = [
  { s: 60, l: '60 segundos' }, { s: 300, l: '5 minutos' }, { s: 600, l: '10 minutos' },
  { s: 3600, l: '1 hora' }, { s: 86400, l: '1 dia' }, { s: 604800, l: '1 semana' },
]

/** Castigo (timeout): a pessoa continua lendo e ouvindo, mas não escreve, reage nem fala. */
export function TimeoutModal({ serverId, userId, name, active }: { serverId: string; userId: string; name: string; active: boolean }) {
  const close = useCloseModal()
  const qc = useQueryClient()
  const [secs, setSecs] = useState(600)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async (seconds: number) => {
    setBusy(true)
    try {
      await rpc('timeout_member', { p_server: serverId, p_user: userId, p_seconds: seconds, p_reason: reason })
      await qc.invalidateQueries({ queryKey: qk.members(serverId) })
      toast.success(seconds > 0 ? `${name} está de castigo.` : `Castigo de ${name} removido.`)
      close()
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Castigar ${name}`}
      description="Durante o castigo a pessoa não pode enviar mensagens, reagir, falar, ligar câmera nem compartilhar tela. Ela continua lendo e ouvindo."
      footer={
        <>
          {active && <button className="btn btn-ghost mr-auto" disabled={busy} onClick={() => void run(0)}>Remover castigo</button>}
          <button className="btn btn-ghost" onClick={close}>Cancelar</button>
          <button className="btn btn-danger" disabled={busy} onClick={() => void run(secs)}>{busy && <Spinner size={14} />} Castigar</button>
        </>
      }
    >
      <div className="field mb-3">
        <label htmlFor="to-dur">Duração</label>
        <select id="to-dur" className="select" value={secs} onChange={(e) => setSecs(Number(e.target.value))}>
          {DURATIONS.map((d) => <option key={d.s} value={d.s}>{d.l}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="to-why">Motivo (opcional, aparece no registro)</label>
        <input id="to-why" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {err && <p className="error-text mt-3" role="alert">{err}</p>}
    </Modal>
  )
}
