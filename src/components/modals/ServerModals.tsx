import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, Hash, Link2, Lock, PlusCircle, Trash2, Volume2 } from 'lucide-react'
import clsx from 'clsx'
import { rpc } from '@/lib/supabase'
import { appOrigin } from '@/lib/env'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { qk, useCategories, useInvites } from '@/data/queries'
import { Modal, Spinner, useAction, useCloseModal, Toggle, confirmAction } from '@/components/ui'
import { toast } from '@/store/ui'
import type { Channel } from '@/lib/types'

/* ------------------------------------------------------ criar / entrar */
export function CreateServerModal({ initialTab = 'create' }: { initialTab?: 'create' | 'join' }) {
  const close = useCloseModal()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState(initialTab)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const { busy, run } = useAction()
  const [error, setError] = useState<string | null>(null)

  const create = () =>
    run(async () => {
      const id = await rpc<string>('create_server', { p_name: name })
      await qc.invalidateQueries({ queryKey: qk.servers })
      close()
      nav(`/app/s/${id}`)
    }, { onError: (e) => setError(errorMessage(e)) })

  const join = () =>
    run(async () => {
      const raw = code.trim()
      const parsed = raw.match(/invite\/([A-Za-z0-9]+)/)?.[1] ?? raw
      const id = await rpc<string>('join_server', { p_code: parsed })
      await qc.invalidateQueries({ queryKey: qk.servers })
      close()
      nav(`/app/s/${id}`)
    }, { onError: (e) => setError(errorMessage(e)) })

  return (
    <Modal
      title={tab === 'create' ? 'Criar um servidor' : 'Entrar em um servidor'}
      description={tab === 'create' ? 'Seu servidor é o lugar do seu grupo conversar. Dê um nome a ele.' : 'Cole o link ou o código de convite que você recebeu.'}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close}>Cancelar</button>
          {tab === 'create'
            ? <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void create()}>{busy && <Spinner size={14} />} Criar</button>
            : <button className="btn btn-primary" disabled={busy || !code.trim()} onClick={() => void join()}>{busy && <Spinner size={14} />} Entrar</button>}
        </>
      }
    >
      <div className="mb-4 flex gap-1 rounded-md bg-tertiary p-1" role="tablist">
        {(['create', 'join'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={clsx('btn btn-sm flex-1', tab === t ? '' : 'btn-ghost')} onClick={() => { setTab(t); setError(null) }}>
            {t === 'create' ? 'Criar' : 'Entrar com convite'}
          </button>
        ))}
      </div>
      {tab === 'create' ? (
        <div className="field">
          <label htmlFor="srv-name">Nome do servidor</label>
          <input id="srv-name" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()} />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="srv-code">Link ou código de convite</label>
          <input id="srv-code" className="input" value={code} placeholder="https://…/invite/abc123def4" onChange={(e) => setCode(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && code.trim() && void join()} />
        </div>
      )}
      {error && <p className="error-text mt-3" role="alert">{error}</p>}
    </Modal>
  )
}

/* -------------------------------------------------------------- convites */
const EXPIRY = [
  { label: '30 minutos', v: 1800 },
  { label: '1 hora', v: 3600 },
  { label: '1 dia', v: 86400 },
  { label: '7 dias', v: 604800 },
  { label: 'Nunca', v: 0 },
]
const USES = [{ label: 'Sem limite', v: 0 }, { label: '1 uso', v: 1 }, { label: '5 usos', v: 5 }, { label: '10 usos', v: 10 }, { label: '25 usos', v: 25 }]

export function inviteLink(code: string) {
  return `${appOrigin()}/invite/${code}`
}

export function InviteModal({ serverId, serverName }: { serverId: string; serverName: string }) {
  const close = useCloseModal()
  const qc = useQueryClient()
  const { data: invites, isLoading } = useInvites(serverId)
  const [expiry, setExpiry] = useState(604800)
  const [uses, setUses] = useState(0)
  const { busy, run } = useAction()

  const create = () =>
    run(async () => {
      const code = await rpc<string>('create_invite', { p_server: serverId, p_expires_seconds: expiry || null, p_max_uses: uses || null })
      await qc.invalidateQueries({ queryKey: qk.invites(serverId) })
      await navigator.clipboard.writeText(inviteLink(code)).catch(() => undefined)
      toast.success('Convite criado e link copiado.')
    })

  const active = (invites ?? []).filter((i) => !i.revoked_at && (!i.expires_at || new Date(i.expires_at) > new Date()) && (!i.max_uses || i.uses < i.max_uses))

  return (
    <Modal title={`Convidar para ${serverName}`} description="Compartilhe o link com seus amigos. Eles precisam ter (ou criar) uma conta.">
      <div className="grid grid-cols-2 gap-3">
        <div className="field"><label htmlFor="inv-exp">Expira em</label>
          <select id="inv-exp" className="select" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>{EXPIRY.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
        <div className="field"><label htmlFor="inv-uses">Máximo de usos</label>
          <select id="inv-uses" className="select" value={uses} onChange={(e) => setUses(Number(e.target.value))}>{USES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></div>
      </div>
      <button className="btn btn-primary mt-3 w-full" disabled={busy} onClick={() => void create()}>{busy ? <Spinner size={14} /> : <Link2 size={16} />} Gerar novo link de convite</button>

      <div className="divider" />
      <div className="label mb-2">Convites ativos</div>
      {isLoading ? <Spinner /> : !active.length ? <p className="text-fg-muted">Nenhum convite ativo.</p> : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {active.map((i) => (
            <li key={i.code} className="flex items-center gap-2 rounded-md bg-secondary p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs">{inviteLink(i.code)}</div>
                <div className="text-[11px] text-fg-muted">{i.expires_at ? `Expira ${formatDateTime(i.expires_at)}` : 'Não expira'} • {i.uses}{i.max_uses ? `/${i.max_uses}` : ''} usos</div>
              </div>
              <button className="icon-btn" aria-label="Copiar link" data-tip="Copiar" onClick={() => void navigator.clipboard.writeText(inviteLink(i.code)).then(() => toast.success('Link copiado.'))}><Copy size={16} /></button>
              <button className="icon-btn danger" aria-label="Revogar convite" data-tip="Revogar" onClick={() => confirmAction({ title: 'Revogar convite', message: 'O link deixará de funcionar imediatamente.', confirmLabel: 'Revogar', danger: true, onConfirm: async () => { await rpc('revoke_invite', { p_code: i.code }); await qc.invalidateQueries({ queryKey: qk.invites(serverId) }) } })}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end"><button className="btn" onClick={close}>Fechar</button></div>
    </Modal>
  )
}

/* ----------------------------------------------------------------- canais */
export function ChannelModal({ serverId, channel, defaultCategory, defaultKind = 'text' }: { serverId: string; channel?: Channel; defaultCategory?: string | null; defaultKind?: 'text' | 'voice' }) {
  const close = useCloseModal()
  const qc = useQueryClient()
  const { data: categories } = useCategories(serverId)
  const [name, setName] = useState(channel?.name ?? '')
  const [kind, setKind] = useState<'text' | 'voice'>(channel?.kind ?? defaultKind)
  const [category, setCategory] = useState<string>(channel?.category_id ?? defaultCategory ?? '')
  const [priv, setPriv] = useState(channel?.is_private ?? false)
  const [topic, setTopic] = useState(channel?.topic ?? '')
  const { busy, run } = useAction()
  const [error, setError] = useState<string | null>(null)

  const save = () =>
    run(async () => {
      if (channel) {
        await rpc('update_channel', { p_channel: channel.id, p_name: name, p_topic: topic, p_private: priv })
      } else {
        await rpc('create_channel', { p_server: serverId, p_name: name, p_kind: kind, p_category: category || null, p_private: priv })
      }
      await qc.invalidateQueries({ queryKey: qk.channels(serverId) })
      close()
    }, { onError: (e) => setError(errorMessage(e)) })

  return (
    <Modal
      title={channel ? 'Editar canal' : 'Criar canal'}
      footer={<><button className="btn btn-ghost" onClick={close}>Cancelar</button><button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>{busy && <Spinner size={14} />} {channel ? 'Salvar' : 'Criar canal'}</button></>}
    >
      <div className="flex flex-col gap-4">
        {!channel && (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Tipo de canal">
            {([['text', 'Texto', 'Envie mensagens, imagens e arquivos', <Hash key="h" size={22} />], ['voice', 'Voz', 'Converse por voz, vídeo e compartilhe a tela', <Volume2 key="v" size={22} />]] as const).map(([k, label, desc, icon]) => (
              <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={clsx('flex items-center gap-3 rounded-md border p-3 text-left', kind === k ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-border bg-secondary')}>
                {icon}<span><span className="block font-semibold">{label}</span><span className="text-xs text-fg-muted">{desc}</span></span>
              </button>
            ))}
          </div>
        )}
        <div className="field"><label htmlFor="ch-name">Nome do canal</label>
          <input id="ch-name" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        {channel && channel.kind === 'text' && (
          <div className="field"><label htmlFor="ch-topic">Tópico</label><input id="ch-topic" className="input" value={topic} maxLength={1024} onChange={(e) => setTopic(e.target.value)} /></div>
        )}
        {!channel && (
          <div className="field"><label htmlFor="ch-cat">Categoria</label>
            <select id="ch-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Sem categoria</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
        )}
        <div className="flex items-center justify-between gap-4">
          <div><div className="flex items-center gap-2 font-semibold"><Lock size={15} /> Canal privado</div><div className="text-xs text-fg-muted">Somente administradores e quem for liberado (por cargo ou pessoa) podem ver.</div></div>
          <Toggle checked={priv} onChange={setPriv} label="Canal privado" />
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}

export function CategoryModal({ serverId, category }: { serverId: string; category?: { id: string; name: string } }) {
  const close = useCloseModal()
  const qc = useQueryClient()
  const [name, setName] = useState(category?.name ?? '')
  const { busy, run } = useAction()
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const save = () =>
    run(async () => {
      if (category) await rpc('update_category', { p_category: category.id, p_name: name })
      else await rpc('create_category', { p_server: serverId, p_name: name })
      await qc.invalidateQueries({ queryKey: qk.categories(serverId) })
      close()
    })
  return (
    <Modal title={category ? 'Renomear categoria' : 'Criar categoria'} footer={<><button className="btn btn-ghost" onClick={close}>Cancelar</button><button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>Salvar</button></>}>
      <div className="field"><label htmlFor="cat-name">Nome da categoria</label>
        <input id="cat-name" ref={ref} className="input" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && void save()} /></div>
    </Modal>
  )
}

export function NewMenuIcon() {
  return <PlusCircle size={16} />
}
