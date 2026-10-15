import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { MessageCircle } from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useSession } from '@/store/session'
import { qk } from '@/data/queries'
import { Avatar, CenterSpinner, Spinner } from '@/components/ui'
import { NotConfiguredPage } from './Auth'
import { isConfigured } from '@/lib/env'

interface Preview {
  server_id: string
  name: string
  icon_path: string | null
  member_count: number
  valid: boolean
  already_member: boolean
}

export function InvitePage() {
  const { code = '' } = useParams()
  const phase = useSession((s) => s.phase)
  const nav = useNavigate()
  const qc = useQueryClient()
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (phase !== 'ready') return
    let cancelled = false
    rpc<Preview[]>('preview_invite', { p_code: code }).then(
      (rows) => !cancelled && setPreview(rows?.[0] ?? null),
      (e) => !cancelled && (setError(errorMessage(e)), setPreview(null)),
    )
    return () => {
      cancelled = true
    }
  }, [phase, code])

  if (!isConfigured) return <NotConfiguredPage />
  if (phase === 'loading') return <CenterSpinner />
  if (phase === 'signedOut') return <Navigate to={`/login?next=${encodeURIComponent(`/invite/${code}`)}`} replace />

  const join = async () => {
    setBusy(true)
    setError(null)
    try {
      const id = await rpc<string>('join_server', { p_code: code })
      await qc.invalidateQueries({ queryKey: qk.servers })
      nav(`/app/s/${id}`, { replace: true })
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-full place-items-center p-4" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, var(--accent-soft), transparent), var(--bg-tertiary)' }}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-primary p-8 text-center shadow-[var(--shadow)]">
        {preview === undefined ? <Spinner size={28} className="mx-auto" /> : !preview || !preview.valid ? (
          <>
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-tertiary"><MessageCircle /></div>
            <h1 className="m-0 text-xl font-bold">Convite inválido</h1>
            <p className="text-fg-2">{error ?? 'Este convite expirou, foi revogado, atingiu o limite de usos ou você está banido do servidor.'}</p>
            <Link to="/app" className="btn btn-primary">Ir para o app</Link>
          </>
        ) : (
          <>
            <p className="m-0 mb-4 text-fg-2">Você foi convidado para entrar em</p>
            <div className="mb-3 flex justify-center"><Avatar path={preview.icon_path} name={preview.name} id={preview.server_id} size={80} square /></div>
            <h1 className="m-0 text-2xl font-bold">{preview.name}</h1>
            <p className="text-fg-2">{preview.member_count} {preview.member_count === 1 ? 'membro' : 'membros'}</p>
            {error && <p className="error-text" role="alert">{error}</p>}
            {preview.already_member
              ? <Link to={`/app/s/${preview.server_id}`} className="btn btn-primary w-full">Você já está aqui — abrir</Link>
              : <button className="btn btn-primary h-10 w-full" onClick={() => void join()} disabled={busy}>{busy ? <Spinner size={16} /> : 'Aceitar convite'}</button>}
          </>
        )}
      </div>
    </main>
  )
}
