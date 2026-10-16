import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Globe, ShieldAlert } from 'lucide-react'
import { Spinner } from '@/components/ui'

const REPO = 'luigizanella/vibe-chat'
const RELEASES = `https://github.com/${REPO}/releases/latest`

interface Release {
  tag_name: string
  assets: { name: string; browser_download_url: string; size: number }[]
}

/** Página pública: baixar o instalador Windows (sempre a última versão) ou usar no navegador. */
export function DownloadPage() {
  const [rel, setRel] = useState<Release | null | undefined>(undefined)

  useEffect(() => {
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? (r.json() as Promise<Release>) : null))
      .then(setRel)
      .catch(() => setRel(null))
  }, [])

  const exe = rel?.assets.find((a) => /setup\.exe$/i.test(a.name))

  return (
    <main className="min-h-full overflow-y-auto p-4" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, var(--accent-soft), transparent), var(--bg-tertiary)' }}>
      <div className="mx-auto my-8 w-full max-w-xl rounded-xl border border-border bg-primary p-6 shadow-[var(--shadow)] sm:p-8">
        <div className="mb-5 flex flex-col items-center text-center">
          <img src="/logo.png" alt="Vibe Chat" className="mb-3 h-16 w-16 rounded-2xl" draggable={false} />
          <h1 className="m-0 text-2xl font-bold">Vibe Chat</h1>
          <p className="mt-1 mb-0 text-fg-2">Escolha como quer usar.</p>
        </div>

        <div className="flex flex-col gap-3">
          <Link to="/login" className="btn btn-primary h-12 text-base no-underline"><Globe size={18} /> Usar no navegador</Link>
          {rel === undefined ? (
            <button className="btn h-12" disabled><Spinner size={16} /> Procurando a última versão…</button>
          ) : exe ? (
            <a href={exe.browser_download_url} className="btn h-12 text-base no-underline"><Download size={18} /> Baixar para Windows ({rel?.tag_name}, {(exe.size / 1048576).toFixed(1)} MB)</a>
          ) : (
            <a href={RELEASES} target="_blank" rel="noopener noreferrer" className="btn h-12 text-base no-underline"><Download size={18} /> Baixar para Windows (página de versões)</a>
          )}
          {rel === null && <p className="hint m-0">Não conseguimos consultar a versão mais recente agora; o botão leva à página de versões.</p>}
        </div>

        <section className="mt-6 rounded-lg border border-border bg-secondary p-4">
          <h2 className="m-0 mb-2 flex items-center gap-2 text-base"><ShieldAlert size={18} className="text-warning" /> O Windows vai mostrar um aviso</h2>
          <p className="mt-0 text-fg-2">O instalador ainda não é assinado digitalmente (certificado é pago), então o <strong>SmartScreen</strong> pode exibir “O Windows protegeu seu computador”. Para continuar:</p>
          <ol className="m-0 pl-5 text-fg-2">
            <li>Clique em <strong>Mais informações</strong>.</li>
            <li>Clique em <strong>Executar assim mesmo</strong>.</li>
          </ol>
          <p className="mb-0 text-xs text-fg-muted">O app se atualiza sozinho quando sai uma versão nova. Você também pode usar direto no navegador, sem instalar nada.</p>
        </section>
      </div>
    </main>
  )
}
