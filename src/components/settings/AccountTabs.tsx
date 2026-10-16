import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { supabase, rpc } from '@/lib/supabase'
import { appOrigin } from '@/lib/env'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { mediaUrl, removePublicFile, uploadPublicImage } from '@/lib/media'
import { useSession } from '@/store/session'
import { toast } from '@/store/ui'
import { Avatar, ConfirmModal, Modal, SettingRow, Spinner, useAction, useCloseModal } from '@/components/ui'
import { useBlocks, qk } from '@/data/queries'
import { useUI } from '@/store/ui'
import type { Profile } from '@/lib/types'

const H = ({ children }: { children: React.ReactNode }) => <h2 className="mt-0 mb-5 text-xl font-bold">{children}</h2>

export function ProfileTab() {
  const { profile, user, setProfile } = useSession()
  const qc = useQueryClient()
  const [displayName, setDisplayName] = useState(profile!.display_name)
  const [username, setUsername] = useState(profile!.username)
  const [bio, setBio] = useState(profile!.bio)
  const [bannerColor, setBannerColor] = useState(profile!.banner_color ?? '#5865f2')
  const [avatar, setAvatar] = useState(profile!.avatar_path)
  const [banner, setBanner] = useState(profile!.banner_path)
  const [unameState, setUnameState] = useState<'ok' | 'taken' | 'invalid'>('ok')
  const { busy, run } = useAction()
  const avatarRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)
  if (!profile || !user) return null

  const checkUsername = async (v: string) => {
    setUsername(v)
    const u = v.trim().toLowerCase()
    if (u === profile.username) return setUnameState('ok')
    if (!/^[a-z0-9_.]{2,32}$/.test(u)) return setUnameState('invalid')
    const { data } = await supabase.rpc('username_available', { p_username: u })
    setUnameState(data ? 'ok' : 'taken')
  }

  const upload = (kind: 'avatars' | 'banners', f: File | undefined) => {
    if (!f) return
    void run(async () => {
      const path = await uploadPublicImage(kind, user.id, f)
      if (kind === 'avatars') setAvatar(path)
      else setBanner(path)
    })
  }

  const dirty = displayName !== profile.display_name || username.trim().toLowerCase() !== profile.username || bio !== profile.bio ||
    avatar !== profile.avatar_path || banner !== profile.banner_path || bannerColor !== (profile.banner_color ?? '#5865f2')

  const save = () =>
    run(async () => {
      const { data, error } = await supabase.from('profiles').update({
        display_name: displayName.trim(), username: username.trim().toLowerCase(), bio, avatar_path: avatar, banner_path: banner, banner_color: bannerColor,
      }).eq('id', user.id).select().single()
      if (error) throw error
      // apaga arquivos substituídos
      if (profile.avatar_path && profile.avatar_path !== avatar) void removePublicFile(profile.avatar_path)
      if (profile.banner_path && profile.banner_path !== banner) void removePublicFile(profile.banner_path)
      setProfile(data as Profile)
      void qc.invalidateQueries({ queryKey: qk.profile(user.id) })
      toast.success('Perfil atualizado.')
    })

  const bannerUrl = mediaUrl(banner)

  return (
    <div className="max-w-xl">
      <H>Meu perfil</H>
      <div className="mb-16 overflow-visible rounded-lg border border-border bg-secondary">
        <div className="relative h-28 rounded-t-lg" style={{ background: bannerUrl ? `center/cover url(${bannerUrl})` : bannerColor }}>
          <button className="btn btn-sm absolute top-2 right-2 bg-black/50 text-white" onClick={() => bannerRef.current?.click()}><Camera size={14} /> Banner</button>
          {banner && <button className="btn btn-sm absolute top-2 right-24 bg-black/50 text-white" onClick={() => setBanner(null)}>Remover</button>}
          <button className="group absolute -bottom-10 left-4 rounded-full ring-4 ring-[var(--bg-secondary)]" onClick={() => avatarRef.current?.click()} aria-label="Alterar avatar">
            <Avatar path={avatar} name={displayName || username} id={user.id} size={80} />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"><Camera /></span>
          </button>
        </div>
        <div className="h-12" />
      </div>
      <input ref={avatarRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { upload('avatars', e.target.files?.[0]); e.target.value = '' }} />
      <input ref={bannerRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { upload('banners', e.target.files?.[0]); e.target.value = '' }} />

      <div className="mb-4 flex items-center gap-2">
        <button className="btn btn-sm" onClick={() => avatarRef.current?.click()}>Alterar avatar</button>
        {avatar && <button className="btn btn-sm btn-ghost" onClick={() => setAvatar(null)}><Trash2 size={13} /> Restaurar avatar padrão</button>}
        <span className="hint ml-auto">PNG, JPEG, WebP ou GIF • até 5 MB</span>
      </div>

      <div className="flex flex-col gap-4">
        <div className="field"><label htmlFor="p-dn">Nome de exibição</label><input id="p-dn" className="input" maxLength={32} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
        <div className="field"><label htmlFor="p-un">Nome de usuário</label>
          <input id="p-un" className="input" value={username} onChange={(e) => void checkUsername(e.target.value)} aria-invalid={unameState !== 'ok'} />
          {unameState === 'taken' && <span className="error-text">Já está em uso.</span>}
          {unameState === 'invalid' && <span className="error-text">Use 2–32 letras minúsculas, números, “_” ou “.”.</span>}
        </div>
        <div className="field"><label htmlFor="p-bio">Sobre mim</label><textarea id="p-bio" className="textarea" maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} /><span className="hint">{bio.length}/300 · Links http/https ficam clicáveis no seu perfil.</span></div>
        <div className="field"><label htmlFor="p-bc">Cor do banner</label><input id="p-bc" type="color" value={bannerColor} onChange={(e) => setBannerColor(e.target.value)} className="h-9 w-16 cursor-pointer rounded border-0 bg-transparent p-0" /></div>
      </div>
      <p className="hint mt-4">Conta criada em {formatDate(profile.created_at)}.</p>
      <button className="btn btn-primary mt-2" disabled={busy || !dirty || unameState !== 'ok' || !username.trim()} onClick={() => void save()}>{busy && <Spinner size={14} />} Salvar alterações</button>
    </div>
  )
}

/** Linha "rótulo / valor / Editar" da tela de conta. */
function InfoRow({ label, value, onEdit, hint }: { label: string; value: string; onEdit?: () => void; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-xs font-bold text-fg-muted uppercase">{label}</div>
        <div className="truncate">{value}</div>
        {hint && <div className="text-xs text-fg-muted">{hint}</div>}
      </div>
      {onEdit && <button className="btn btn-sm shrink-0" onClick={onEdit}>Editar</button>}
    </div>
  )
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

export function AccountTab() {
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
    <div className="max-w-xl">
      <H>Conta</H>
      <div className="card mb-6">
        <h3 className="mt-0 mb-1 text-base">Informações da conta</h3>
        <InfoRow label="Nome de exibição" value={profile.display_name || '—'} onEdit={() => open(<EditFieldModal title="Nome de exibição" label="Nome de exibição" initial={profile.display_name} maxLength={32} validate={(v) => (v.trim() ? null : 'Informe um nome.')} onSave={(v) => saveProfile({ display_name: v })} />)} />
        <InfoRow label="Nome de usuário" value={`@${profile.username}`} onEdit={() => open(<EditFieldModal title="Nome de usuário" label="Nome de usuário" initial={profile.username} maxLength={32} validate={(v) => (/^[a-z0-9_.]{2,32}$/.test(v.trim().toLowerCase()) ? null : 'Use 2–32 letras minúsculas, números, “_” ou “.”.')} onSave={async (v) => {
          const u = v.toLowerCase()
          const { data } = await supabase.rpc('username_available', { p_username: u })
          if (!data) throw new Error('Este nome de usuário já está em uso.')
          await saveProfile({ username: u })
        }} />)} />
        <InfoRow label="E-mail" value={user.email ?? '—'} hint="A troca exige confirmação por e-mail." onEdit={() => open(<EditFieldModal title="Alterar e-mail" label="Novo e-mail" type="email" initial="" maxLength={120} validate={(v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'E-mail inválido.')} onSave={async (v) => {
          const { error } = await supabase.auth.updateUser({ email: v }, { emailRedirectTo: `${appOrigin()}/login` })
          if (error) throw error
          toast.success('Enviamos links de confirmação. Confirme no(s) e-mail(s) para concluir a troca.')
        }} />)} />
        <InfoRow label="Conta criada em" value={formatDate(profile.created_at)} />
      </div>

      <h3 className="mt-8 text-danger">Remoção da conta</h3>
      <SettingRow title="Desativar conta" description="Você fica invisível e não pode enviar mensagens. Pode reativar ao entrar novamente.">
        <button className="btn btn-danger" onClick={() => open(<ConfirmModal title="Desativar conta" message="Sua conta ficará invisível. Você poderá reativá-la quando entrar de novo." confirmLabel="Desativar" danger onConfirm={async () => { await rpc('deactivate_account'); await signOut() }} />)}>Desativar</button>
      </SettingRow>
      <SettingRow title="Excluir conta" description="Permanente. Suas mensagens permanecem sem autor; servidores que você possui são transferidos ou apagados.">
        <button className="btn btn-danger" onClick={() => open(<ConfirmModal title="Excluir conta definitivamente" message={<>Isso <strong>não pode ser desfeito</strong>. Servidores que você possui serão transferidos ao membro mais antigo (ou excluídos se estiverem vazios).</>} requireText="EXCLUIR" confirmLabel="Excluir minha conta" danger onConfirm={async () => {
          const { error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'EXCLUIR' } })
          if (error) throw new Error('Não foi possível excluir a conta agora. A função "delete-account" está publicada?')
          await signOut()
        }} />)}>Excluir</button>
      </SettingRow>
    </div>
  )
}

export function SecurityTab() {
  const { user } = useSession()
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const pwOp = useAction()
  const changePw = () => pwOp.run(async () => {
    if (pw !== pw2) throw new Error('As senhas não coincidem.')
    // reautenticação com a senha atual antes de trocar
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: user!.email!, password: cur })
    if (authErr) throw new Error('Senha atual incorreta.')
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) throw error
    toast.success('Senha alterada.')
    setCur(''); setPw(''); setPw2('')
  })
  return (
    <div className="max-w-xl">
      <H>Senha e segurança</H>
      <h3 className="mt-0">Alterar senha</h3>
      <div className="flex flex-col gap-3">
        <input className="input" type="password" placeholder="Senha atual" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" aria-label="Senha atual" />
        <input className="input" type="password" placeholder="Nova senha (mín. 8)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" aria-label="Nova senha" />
        <input className="input" type="password" placeholder="Confirmar nova senha" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" aria-label="Confirmar nova senha" />
        <button className="btn btn-primary self-start" disabled={pwOp.busy || !cur || pw.length < 8} onClick={() => void changePw()}>{pwOp.busy && <Spinner size={14} />} Alterar senha</button>
      </div>
      <div className="divider" />
      <SettingRow title="Autenticação em dois fatores" description="Em breve."><span className="rounded bg-tertiary px-2 py-0.5 text-xs text-fg-muted">Em breve</span></SettingRow>
    </div>
  )
}

export function SoonTab({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-xl">
      <H>{title}</H>
      <div className="card text-fg-2"><strong className="text-fg">Em breve.</strong> {children ?? 'Esta área ainda não foi implementada nesta versão.'}</div>
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
    <div className="max-w-xl">
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
    <div className="max-w-xl">
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
