import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Camera, Trash2, Users } from 'lucide-react'
import { supabase, rpc } from '@/lib/supabase'
import { appOrigin } from '@/lib/env'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { mediaUrl, removePublicFile, uploadPublicImage } from '@/lib/media'
import { useSession } from '@/store/session'
import { toast } from '@/store/ui'
import { Avatar, ConfirmModal, Modal, SettingRow, Spinner, useAction, useCloseModal } from '@/components/ui'
import { useBlocks, useMembers, useRoles, qk } from '@/data/queries'
import { useUI } from '@/store/ui'
import type { Profile } from '@/lib/types'

const H = ({ children }: { children: React.ReactNode }) => <h2 className="mt-0 mb-5 text-xl font-bold">{children}</h2>

/** Frase de status em pílula (card de perfil, prévia do editor). */
export function StatusPill({ text }: { text: string }) {
  if (!text.trim()) return null
  return <span className="max-w-full truncate rounded-full border border-border bg-[var(--bg-tertiary)] px-3 py-1 text-xs font-medium text-fg">{text}</span>
}

function hueOf(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export function ProfileTab() {
  const { profile, user, setProfile } = useSession()
  const qc = useQueryClient()
  const { serverId } = useParams()
  const { data: members } = useMembers(serverId)
  const { data: roles } = useRoles(serverId)
  const [displayName, setDisplayName] = useState(profile!.display_name)
  const [status, setStatus] = useState(profile!.custom_status)
  const [bio, setBio] = useState(profile!.bio)
  const [avatar, setAvatar] = useState(profile!.avatar_path)
  const [banner, setBanner] = useState(profile!.banner_path)
  const { busy, run } = useAction()
  const avatarRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)
  const bioRef = useRef<HTMLTextAreaElement>(null)

  // a biografia cresce com o texto (sem rolagem interna)
  useLayoutEffect(() => {
    const el = bioRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [bio])

  if (!profile || !user) return null
  const mine = members?.find((m) => m.user_id === user.id)
  const myRoles = (roles ?? []).filter((r) => !r.is_default && mine?.member_roles.some((mr) => mr.role_id === r.id))
  const dirty = displayName !== profile.display_name || status !== profile.custom_status || bio !== profile.bio || avatar !== profile.avatar_path || banner !== profile.banner_path
  const discard = () => { setDisplayName(profile.display_name); setStatus(profile.custom_status); setBio(profile.bio); setAvatar(profile.avatar_path); setBanner(profile.banner_path) }

  const upload = (kind: 'avatars' | 'banners', f: File | undefined) => {
    if (!f) return
    void run(async () => {
      const path = await uploadPublicImage(kind, user.id, f)
      if (kind === 'avatars') setAvatar(path)
      else setBanner(path)
    })
  }

  const save = () =>
    run(async () => {
      const { data, error } = await supabase.from('profiles').update({
        display_name: displayName.trim(), bio, custom_status: status.trim(), avatar_path: avatar, banner_path: banner,
      }).eq('id', user.id).select().single()
      if (error) throw error
      if (profile.avatar_path && profile.avatar_path !== avatar) void removePublicFile(profile.avatar_path)
      if (profile.banner_path && profile.banner_path !== banner) void removePublicFile(profile.banner_path)
      setProfile(data as Profile)
      void qc.invalidateQueries({ queryKey: qk.profile(user.id) })
      void qc.invalidateQueries({ queryKey: ['members'] })
      toast.success('Perfil atualizado.')
    })

  const bannerUrl = mediaUrl(banner)
  const name = displayName.trim() || profile.username
  const bannerBg = bannerUrl ? `center/cover url(${bannerUrl})` : (profile.banner_color ?? `linear-gradient(135deg, hsl(${hueOf(user.id)} 60% 45%), hsl(${(hueOf(user.id) + 50) % 360} 65% 35%))`)

  return (
    <div className="mx-auto max-w-5xl pb-20">
      <H>Perfil</H>
      <input ref={avatarRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { upload('avatars', e.target.files?.[0]); e.target.value = '' }} />
      <input ref={bannerRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { upload('banners', e.target.files?.[0]); e.target.value = '' }} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-6">
          <section className="rounded-xl border border-border bg-secondary p-4">
            <label htmlFor="p-dn" className="label mb-1 block">Nome de exibição</label>
            <input id="p-dn" className="input" maxLength={32} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <div className="mt-1 text-xs text-fg-muted">@{profile.username}</div>
          </section>

          <section className="rounded-xl border border-border bg-secondary p-4">
            <label htmlFor="p-st" className="label mb-1 block">Frase de status</label>
            <input id="p-st" className="input" maxLength={40} placeholder="Ex.: Web Designer, de volta já" value={status} onChange={(e) => setStatus(e.target.value)} />
            <div className="mt-1 text-xs text-fg-muted">Aparece ao lado do seu avatar, abaixo do nome na lista de membros e no seu painel. {status.length}/40</div>
          </section>

          <section className="rounded-xl border border-border bg-secondary p-4">
            <label htmlFor="p-bio" className="label mb-1 block">Sobre mim</label>
            <textarea ref={bioRef} id="p-bio" rows={2} className="w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-fg outline-none" maxLength={300} placeholder="Conte um pouco sobre você" value={bio} onChange={(e) => setBio(e.target.value)} />
            <div className="mt-1 text-right text-xs text-fg-muted">{bio.length}/300</div>
          </section>

          <section className="rounded-xl border border-border bg-secondary p-4">
            <div className="label mb-2">Membro desde</div>
            <div className="flex flex-col gap-1 text-sm text-fg-2">
              <span className="flex items-center gap-2"><CalendarDays size={14} aria-hidden /> No app: {formatDate(profile.created_at)}</span>
              {mine && <span className="flex items-center gap-2"><Users size={14} aria-hidden /> No servidor atual: {formatDate(mine.joined_at)}</span>}
            </div>
            {myRoles.length > 0 && (
              <>
                <div className="label mt-4 mb-2">Cargos</div>
                <div className="flex flex-wrap gap-1.5">
                  {myRoles.map((r) => (
                    <span key={r.id} className="flex items-center gap-1.5 rounded-md bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs font-semibold"><span className="h-3 w-3 rounded-full" style={{ background: r.color }} />{r.name}</span>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        {/* prévia ao vivo: como as outras pessoas veem */}
        <aside aria-label="Prévia do perfil" className="lg:sticky lg:top-0 lg:self-start">
          <div className="label mb-2">Prévia</div>
          <div className="overflow-hidden rounded-xl border border-border bg-[var(--bg-tertiary)] shadow-[var(--shadow)]">
            <div className="group/b relative h-[110px]" style={{ background: bannerBg }}>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover/b:opacity-100 focus-within:opacity-100">
                <button className="grid h-8 w-8 place-items-center rounded-full border-0 bg-black/60 text-white hover:bg-black/80" onClick={() => bannerRef.current?.click()} aria-label="Trocar banner" data-tip="Trocar banner"><Camera size={15} /></button>
                {banner && <button className="grid h-8 w-8 place-items-center rounded-full border-0 bg-black/60 text-white hover:bg-black/80" onClick={() => setBanner(null)} aria-label="Remover banner" data-tip="Remover banner"><Trash2 size={15} /></button>}
              </div>
            </div>
            <div className="px-4 pb-4">
              <div className="-mt-12 mb-2 flex items-end gap-3">
                <div className="group/a relative shrink-0 rounded-full ring-[6px] ring-[var(--bg-tertiary)]">
                  <button className="block rounded-full border-0 bg-transparent p-0" onClick={() => avatarRef.current?.click()} aria-label="Trocar foto do perfil">
                    <Avatar path={avatar} name={name} id={user.id} size={96} />
                    <span className="absolute inset-0 grid place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover/a:opacity-100"><Camera size={22} /></span>
                  </button>
                  {avatar && <button className="absolute -right-1 -bottom-1 grid h-7 w-7 place-items-center rounded-full border border-border bg-[var(--bg-elevated)] text-fg opacity-0 transition-opacity group-hover/a:opacity-100 focus-visible:opacity-100" onClick={() => setAvatar(null)} aria-label="Remover foto" data-tip="Remover foto"><Trash2 size={13} /></button>}
                </div>
                <div className="min-w-0 pb-1"><StatusPill text={status} /></div>
              </div>
              <div className="rounded-lg bg-[var(--bg-primary)] p-3">
                <div className="truncate text-xl font-bold">{name}</div>
                <div className="text-sm text-fg-2">@{profile.username}</div>
                {bio.trim() && (<><div className="my-3 h-px bg-[var(--border)]" /><div className="label mb-1">Sobre mim</div><div className="text-sm break-words whitespace-pre-wrap text-fg-2">{bio}</div></>)}
                <div className="my-3 h-px bg-[var(--border)]" />
                <div className="label mb-1">Membro desde</div>
                <div className="text-sm text-fg-2">{formatDate(profile.created_at)}</div>
                {myRoles.length > 0 && (<><div className="label mt-3 mb-1">Cargos</div><div className="flex flex-wrap gap-1.5">{myRoles.map((r) => <span key={r.id} className="flex items-center gap-1.5 rounded-md bg-[var(--bg-secondary)] px-2 py-0.5 text-xs font-semibold"><span className="h-3 w-3 rounded-full" style={{ background: r.color }} />{r.name}</span>)}</div></>)}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-10 mt-6 flex items-center justify-between gap-3 rounded-xl border border-border bg-[var(--bg-elevated)] px-4 py-3 shadow-[var(--shadow)]" role="status">
          <span className="text-sm">Você tem alterações não salvas.</span>
          <span className="flex gap-2">
            <button className="btn btn-ghost" onClick={discard} disabled={busy}>Descartar</button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !displayName.trim()}>{busy && <Spinner size={14} />} Salvar alterações</button>
          </span>
        </div>
      )}
    </div>
  )
}
/** Linha "rótulo / valor / Editar" da tela de conta. */
function InfoRow({ label, value, onEdit, action = 'Editar', hint, danger }: { label: string; value?: string; onEdit?: () => void; action?: string; hint?: string; danger?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
      <div className="min-w-0 shrink-0">
        <div className="text-[13px] font-bold text-fg">{label}</div>
        {hint && <div className="text-xs text-fg-muted">{hint}</div>}
      </div>
      <div className="flex min-w-0 max-w-full items-center gap-4">
        {value && <span className="min-w-0 truncate text-fg-2">{value}</span>}
        {onEdit && <button className={danger ? 'btn btn-danger shrink-0' : 'btn shrink-0'} onClick={onEdit}>{action}</button>}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h3 className="mt-0 mb-3 text-lg font-bold">{title}</h3>
      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-border bg-secondary">{children}</div>
    </section>
  )
}

function maskEmail(e: string) {
  const [u, d] = e.split('@')
  return d ? `${u.slice(0, 1)}${'*'.repeat(Math.max(3, Math.min(u.length - 1, 6)))}@${d}` : e
}

function EditFieldModal({ title, label, initial, type = 'text', maxLength = 64, validate, onSave }: { title: string; label: string; initial: string; type?: string; maxLength?: number; validate?: (v: string) => string | null; onSave: (v: string) => Promise<void> }) {
  const close = useCloseModal()
  const [v, setV] = useState(initial)
  const { busy, run } = useAction()
  const problem = validate?.(v) ?? null
  const save = () => run(async () => { await onSave(v.trim()); close() })
  return (
    <Modal title={title} footer={<><button className="btn btn-ghost" onClick={close}>Cancelar</button><button className="btn btn-primary" disabled={busy || !!problem || v.trim() === initial} onClick={() => void save()}>{busy && <Spinner size={14} />} Salvar</button></>}>
      <div className="field"><label htmlFor="ef">{label}</label>
        <input id="ef" className="input" type={type} maxLength={maxLength} value={v} autoFocus onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !problem && void save()} aria-invalid={!!problem} />
        {problem && v.trim() !== initial && <span className="error-text">{problem}</span>}
      </div>
    </Modal>
  )
}

function ChangePasswordModal() {
  const close = useCloseModal()
  const { user } = useSession()
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const { busy, run } = useAction()
  const save = () => run(async () => {
    if (pw !== pw2) throw new Error('As senhas não coincidem.')
    // reautenticação com a senha atual antes de trocar
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: user!.email!, password: cur })
    if (authErr) throw new Error('Senha atual incorreta.')
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) throw error
    toast.success('Senha alterada.')
    close()
  })
  return (
    <Modal title="Alterar senha" footer={<><button className="btn btn-ghost" onClick={close}>Cancelar</button><button className="btn btn-primary" disabled={busy || !cur || pw.length < 8} onClick={() => void save()}>{busy && <Spinner size={14} />} Alterar senha</button></>}>
      <div className="flex flex-col gap-3">
        <input className="input" type="password" placeholder="Senha atual" value={cur} autoFocus onChange={(e) => setCur(e.target.value)} autoComplete="current-password" aria-label="Senha atual" />
        <input className="input" type="password" placeholder="Nova senha (mín. 8)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" aria-label="Nova senha" />
        <input className="input" type="password" placeholder="Confirmar nova senha" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" aria-label="Confirmar nova senha" />
      </div>
    </Modal>
  )
}

export function AccountTab({ goto }: { goto?: (tab: 'profile') => void }) {
  const { user, profile, signOut, setProfile } = useSession()
  const open = useUI((s) => s.openModal)
  const qc = useQueryClient()
  if (!user || !profile) return null

  const saveProfile = async (patch: Partial<Profile>) => {
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', user.id).select().single()
    if (error) throw error
    setProfile(data as Profile)
    void qc.invalidateQueries({ queryKey: qk.profile(user.id) })
    toast.success('Atualizado.')
  }

  return (
    <div className="mx-auto max-w-3xl">
      <H>Conta</H>
      <Section title="Informações da conta">
        <InfoRow label="Nome de exibição" value={profile.display_name || '—'} onEdit={() => open(<EditFieldModal title="Nome de exibição" label="Nome de exibição" initial={profile.display_name} maxLength={32} validate={(v) => (v.trim() ? null : 'Informe um nome.')} onSave={(v) => saveProfile({ display_name: v })} />)} />
        <InfoRow label="Nome de usuário" value={`@${profile.username}`} onEdit={() => open(<EditFieldModal title="Nome de usuário" label="Nome de usuário" initial={profile.username} maxLength={32} validate={(v) => (/^[a-z0-9_.]{2,32}$/.test(v.trim().toLowerCase()) ? null : 'Use 2–32 letras minúsculas, números, “_” ou “.”.')} onSave={async (v) => {
          const u = v.toLowerCase()
          const { data } = await supabase.rpc('username_available', { p_username: u })
          if (!data) throw new Error('Este nome de usuário já está em uso.')
          await saveProfile({ username: u })
        }} />)} />
        <InfoRow label="E-mail" value={maskEmail(user.email ?? '—')} hint="A troca exige confirmação por e-mail." onEdit={() => open(<EditFieldModal title="Alterar e-mail" label="Novo e-mail" type="email" initial="" maxLength={120} validate={(v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'E-mail inválido.')} onSave={async (v) => {
          const { error } = await supabase.auth.updateUser({ email: v }, { emailRedirectTo: `${appOrigin()}/login` })
          if (error) throw error
          toast.success('Enviamos links de confirmação. Confirme no(s) e-mail(s) para concluir a troca.')
        }} />)} />
        <InfoRow label="Perfil" value="Avatar, banner, bio e frase de status" action="Editar perfil" onEdit={() => goto?.('profile')} />
        <InfoRow label="Conta criada em" value={formatDate(profile.created_at)} />
      </Section>

      <Section title="Senha e segurança">
        <InfoRow label="Senha" hint="Pedimos a senha atual para confirmar a troca." onEdit={() => open(<ChangePasswordModal />)} />
        <InfoRow label="Autenticação em dois fatores" value="Em breve" />
        <InfoRow label="Sair desta conta" value="Encerra a sessão neste aparelho." action="Sair" danger onEdit={() => void signOut()} />
      </Section>

      <Section title="Remoção da conta">
        <InfoRow label="Desativar conta" hint="Você fica invisível e não pode enviar mensagens. Pode reativar ao entrar de novo." action="Desativar" danger onEdit={() => open(<ConfirmModal title="Desativar conta" message="Sua conta ficará invisível. Você poderá reativá-la quando entrar de novo." confirmLabel="Desativar" danger onConfirm={async () => { await rpc('deactivate_account'); await signOut() }} />)} />
        <InfoRow label="Excluir conta" hint="Permanente. Servidores que você possui são transferidos ou apagados." action="Excluir" danger onEdit={() => open(<ConfirmModal title="Excluir conta definitivamente" message={<>Isso <strong>não pode ser desfeito</strong>. Servidores que você possui serão transferidos ao membro mais antigo (ou excluídos se estiverem vazios).</>} requireText="EXCLUIR" confirmLabel="Excluir minha conta" danger onConfirm={async () => {
          const { error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'EXCLUIR' } })
          if (error) throw new Error('Não foi possível excluir a conta agora. A função "delete-account" está publicada?')
          await signOut()
        }} />)} />
      </Section>
    </div>
  )
}

/** Estado vazio bonito para áreas ainda não disponíveis. */
export function SoonTab({ title, icon, headline, children }: { title: string; icon?: React.ReactNode; headline?: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl">
      <H>{title}</H>
      <div className="grid place-items-center rounded-xl border border-dashed border-border bg-secondary px-6 py-16 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]" aria-hidden>{icon}</div>
        <span className="mb-2 rounded-full bg-tertiary px-3 py-0.5 text-xs font-semibold text-fg-2">Em breve</span>
        <h3 className="m-0 mb-1 text-lg font-bold">{headline ?? 'Estamos preparando isto'}</h3>
        <p className="m-0 max-w-sm text-fg-2">{children ?? 'Esta área ainda não existe nesta versão.'}</p>
      </div>
    </div>
  )
}
export function PrivacyTab() {
  const { user } = useSession()
  const [prefs, setPrefs] = useState<{ dm_policy: string; friend_requests: string } | null>(null)
  useEffect(() => {
    if (!user) return
    void supabase.from('user_prefs').select('dm_policy,friend_requests').eq('user_id', user.id).maybeSingle().then(({ data }) => setPrefs(data ?? { dm_policy: 'everyone', friend_requests: 'everyone' }))
  }, [user])
  const update = async (patch: Record<string, string>) => {
    setPrefs((p) => (p ? { ...p, ...patch } : p))
    const { error } = await supabase.from('user_prefs').update(patch).eq('user_id', user!.id)
    if (error) toast.error(errorMessage(error))
  }
  return (
    <div className="mx-auto max-w-3xl">
      <H>Privacidade</H>
      {!prefs ? <Spinner /> : (
        <>
          <SettingRow title="Quem pode iniciar mensagem direta" description="Vale para conversas novas; conversas existentes continuam.">
            <select className="select w-48" value={prefs.dm_policy} onChange={(e) => void update({ dm_policy: e.target.value })} aria-label="Política de mensagens diretas">
              <option value="everyone">Qualquer pessoa em comum</option><option value="friends">Somente amigos</option><option value="nobody">Ninguém</option>
            </select>
          </SettingRow>
          <SettingRow title="Pedidos de amizade" description="Quem pode enviar pedidos.">
            <select className="select w-48" value={prefs.friend_requests} onChange={(e) => void update({ friend_requests: e.target.value })} aria-label="Política de pedidos de amizade">
              <option value="everyone">Qualquer pessoa</option><option value="nobody">Ninguém</option>
            </select>
          </SettingRow>
        </>
      )}
    </div>
  )
}

export function BlockedTab() {
  const qc = useQueryClient()
  const { data: blocked, isLoading } = useBlocks()
  return (
    <div className="mx-auto max-w-3xl">
      <H>Usuários bloqueados</H>
      {isLoading ? <Spinner /> : !blocked?.length ? <p className="text-fg-muted">Você não bloqueou ninguém.</p> : blocked.map((p) => (
        <div key={p.id} className="flex items-center gap-3 border-b border-border py-2">
          <Avatar path={p.avatar_path} name={p.display_name} id={p.id} size={32} />
          <div className="flex-1"><div className="font-semibold">{p.display_name}</div><div className="text-xs text-fg-muted">@{p.username}</div></div>
          <button className="btn btn-sm" onClick={() => rpc('unblock_user', { p_user: p.id }).then(() => qc.invalidateQueries({ queryKey: qk.blocks }), (e) => toast.error(errorMessage(e)))}>Desbloquear</button>
        </div>
      ))}
    </div>
  )
}
