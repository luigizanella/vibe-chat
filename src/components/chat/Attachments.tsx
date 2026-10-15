import { useEffect, useState } from 'react'
import { Download, File as FileIcon, ImageOff, X } from 'lucide-react'
import { signedAttachmentUrl, isImage } from '@/lib/media'
import { formatBytes } from '@/lib/format'
import type { Attachment, PendingAttachment } from '@/lib/types'
import { Modal, Spinner } from '@/components/ui'
import { useUI } from '@/store/ui'
import { toast } from '@/store/ui'

function useAttachmentUrl(att: Attachment, pending?: PendingAttachment) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false
    if (pending) {
      revoked = URL.createObjectURL(pending.file)
      setUrl(revoked)
    } else {
      setUrl(null)
      setError(false)
      signedAttachmentUrl(att.storage_path)
        .then((u) => !cancelled && setUrl(u))
        .catch(() => !cancelled && setError(true))
    }
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [att.storage_path, pending])
  return { url, error }
}

function Lightbox({ url, name }: { url: string; name: string }) {
  return (
    <Modal title={name} size="lg">
      <img src={url} alt={name} className="mx-auto max-h-[70vh] max-w-full rounded object-contain" />
    </Modal>
  )
}

async function download(att: Attachment) {
  try {
    const url = await signedAttachmentUrl(att.storage_path, att.file_name)
    const a = document.createElement('a')
    a.href = url
    a.download = att.file_name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch {
    toast.error('Não foi possível baixar o arquivo.')
  }
}

export function AttachmentView({ att, pending }: { att: Attachment; pending?: PendingAttachment }) {
  const { url, error } = useAttachmentUrl(att, pending)
  const open = useUI((s) => s.openModal)
  if (isImage(att.content_type)) {
    return (
      <div className="mt-1 max-w-[min(420px,100%)]">
        {error ? (
          <div className="flex items-center gap-2 rounded bg-tertiary p-3 text-fg-muted"><ImageOff size={16} /> Imagem indisponível</div>
        ) : !url ? (
          <div className="skeleton h-40 w-64" />
        ) : (
          <div className="group relative inline-block">
            <button className="block cursor-zoom-in rounded-md border-0 bg-transparent p-0" onClick={() => open(<Lightbox url={url} name={att.file_name} />)} aria-label={`Ampliar ${att.file_name}`}>
              <img src={url} alt={att.file_name} className="max-h-[320px] max-w-full rounded-md" loading="lazy" />
            </button>
            {!pending && (
              <button className="icon-btn absolute top-1 right-1 bg-black/60 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void download(att)} aria-label="Baixar imagem" data-tip="Baixar">
                <Download size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="mt-1 flex w-full max-w-[420px] items-center gap-3 rounded-md border border-border bg-secondary p-3">
      <FileIcon size={28} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold" title={att.file_name}>{att.file_name}</div>
        <div className="text-xs text-fg-muted">{formatBytes(att.size_bytes)}</div>
      </div>
      {pending ? <Spinner size={16} /> : (
        <button className="icon-btn" onClick={() => void download(att)} aria-label={`Baixar ${att.file_name}`} data-tip="Baixar"><Download size={18} /></button>
      )}
    </div>
  )
}

/** Chips de arquivos selecionados no compositor. */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  const [urls, setUrls] = useState<(string | null)[]>([])
  useEffect(() => {
    const u = files.map((f) => (f.type.startsWith('image/') && f.type !== 'image/svg+xml' ? URL.createObjectURL(f) : null))
    setUrls(u)
    return () => u.forEach((x) => x && URL.revokeObjectURL(x))
  }, [files])
  if (!files.length) return null
  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="relative flex w-36 flex-col gap-1 rounded-md bg-tertiary p-2">
          <div className="grid h-20 place-items-center overflow-hidden rounded bg-[var(--bg-input)]">
            {urls[i] ? <img src={urls[i]!} alt="" className="h-full w-full object-cover" /> : <FileIcon size={28} className="text-fg-muted" />}
          </div>
          <div className="truncate text-xs" title={f.name}>{f.name}</div>
          <div className="text-[11px] text-fg-muted">{formatBytes(f.size)}</div>
          <button className="icon-btn absolute -top-2 -right-2 h-6 w-6 bg-[var(--bg-elevated)]" onClick={() => onRemove(i)} aria-label={`Remover ${f.name}`}><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}
