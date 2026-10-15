import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Camera, CheckCircle2, MailCheck, MessageCircle, XCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { appOrigin, isConfigured } from '@/lib/env'
import { errorMessage } from '@/lib/errors'
import { useSession } from '@/store/session'
import { Avatar, CenterSpinner, Spinner } from '@/components/ui'
import { uploadPublicImage, removePublicFile } from '@/lib/media'
import { toast } from '@/store/ui'

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main
      className="grid min-h-full place-items-center overflow-y-auto p-4"
      style={{ background: 'radial-gradient(1200px 600px at 20% -10%, var(--accent-soft), transparent), var(--bg-tertiary)' }}
    >
      <div className="w-full max-w-[440px] rounded-xl border border-border bg-primary p-6 shadow-[var(--shadow)] sm:p-8" style={{ animation: 'pop-in var(--dur) var(--ease)' }}>
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-white"><MessageCircle size={26} /></div>
          <h1 className="m-0 text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 mb-0 text-fg-2">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="mt-5 text-sm text-fg-2">{footer}</div>}
      </div>
    </main>
  )
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="error-text" id={`${id}-err`} role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function NotConfiguredPage() {
  return (
    <AuthLayout title="Configuração pendente" subtitle="O app ainda não está conectado ao Supabase.">
      <div className="space-y-3 text-fg-2">
        <p className="m-0">Defina as variáveis abaixo em <code>.env.local</code> (veja <code>.env.example</code>) e reinicie o servidor de desenvolvimento:</p>
        <pre className="m-0 overflow-x-auto rounded-md bg-tertiary p-3 text-xs">VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co{'\n'}VITE_SUPABASE_ANON_KEY=sua-chave-anon</pre>
        <p className="m-0">Passo a passo completo: <code>docs/SETUP.md</code>.</p>
      </div>
    </AuthLayout>
  )
}

/* ------------------------------------------------------------------- Login */
export function LoginPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const phase = useSession((s) => s.phase)
  const next = params.get('next') || '/app'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)

  if (!isConfigured) return <NotConfiguredPage />
  if (phase === 'ready' || phase === 'disabled') return <Navigate to={next} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setUnconfirmed(false)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      setError(errorMessage(error))
      setUnconfirmed(/not confirmed/i.test(error.message))
      return
    }
    nav(next, { replace: true })
  }

  const resend = async () => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: appOrigin() } })
    if (error) setError(errorMessage(error))
    else toast.success('E-mail de confirmação reenviado.')
  }

  return (
    <AuthLayout
      title="Bem-vindo de volta!"
      subtitle="Entre para falar com seu grupo."
      footer={<>Precisa de uma conta? <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}>Registrar-se</Link></>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id="email" label="E-mail">
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
        </Field>
        <Field id="password" label="Senha">
          <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <Link to="/forgot" className="text-xs">Esqueceu a senha?</Link>
        </Field>
        {error && (
          <div className="error-text" role="alert">
            {error} {unconfirmed && <button type="button" className="btn btn-sm ml-1" onClick={resend}>Reenviar e-mail</button>}
          </div>
        )}
        <button className="btn btn-primary h-10" disabled={busy || !email || !password}>{busy ? <Spinner size={16} /> : 'Entrar'}</button>
      </form>
    </AuthLayout>
  )
}

/* ---------------------------------------------------------------- Registro */
export function RegisterPage() {
  const [params] = useSearchParams()
  const phase = useSession((s) => s.phase)
  const next = params.get('next') || '/app'
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [available, setAvailable] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle')
  const [sent, setSent] = useState(false)

  const uname = username.trim().toLowerCase()
  useEffect(() => {
    if (!uname) return setAvailable('idle')
    if (!/^[a-z0-9_.]{2,32}$/.test(uname)) return setAvailable('invalid')
    setAvailable('checking')
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('username_available', { p_username: uname })
      setAvailable(error ? 'idle' : data ? 'ok' : 'taken')
    }, 400)
    return () => clearTimeout(t)
  }, [uname])

  if (!isConfigured) return <NotConfiguredPage />
  if (phase === 'ready' || phase === 'disabled') return <Navigate to={next} replace />

  const pwError = password && password.length < 8 ? 'Use pelo menos 8 caracteres.' : null
  const confirmError = confirm && confirm !== password ? 'As senhas não coincidem.' : null
  const canSubmit = email && available === 'ok' && password.length >= 8 && confirm === password && !busy

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { username: uname, display_name: displayName.trim() || uname }, emailRedirectTo: `${appOrigin()}/login` },
    })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    // Se a confirmação de e-mail estiver ativa, não há sessão até confirmar.
    // (Cadastro de e-mail já existente retorna usuário sem identidades.)
    if (!data.session) setSent(true)
  }

  if (sent)
    return (
      <AuthLayout title="Confirme seu e-mail">
        <div className="flex flex-col items-center gap-3 text-center text-fg-2">
          <MailCheck size={40} className="text-success" />
          <p className="m-0">Enviamos um link de confirmação para <strong>{email}</strong>. Abra o e-mail (verifique o spam) e depois entre.</p>
          <Link to="/login" className="btn btn-primary">Ir para o login</Link>
        </div>
      </AuthLayout>
    )

  return (
    <AuthLayout title="Criar uma conta" footer={<>Já tem conta? <Link to="/login">Entrar</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id="r-email" label="E-mail"><input id="r-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus /></Field>
        <Field
          id="r-user"
          label="Nome de usuário"
          error={available === 'taken' ? 'Este nome de usuário já está em uso.' : available === 'invalid' ? 'Use 2–32 letras minúsculas, números, "_" ou ".".' : null}
          hint={available === 'ok' ? undefined : 'Único e permanente para amigos te encontrarem.'}
        >
          <div className="relative">
            <input id="r-user" className="input pr-9" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required aria-invalid={available === 'taken' || available === 'invalid'} />
            <span className="absolute top-1/2 right-3 -translate-y-1/2">
              {available === 'checking' ? <Spinner size={14} /> : available === 'ok' ? <CheckCircle2 size={16} className="text-success" /> : available === 'taken' || available === 'invalid' ? <XCircle size={16} className="text-danger" /> : null}
            </span>
          </div>
        </Field>
        <Field id="r-name" label="Nome de exibição (opcional)"><input id="r-name" className="input" value={displayName} maxLength={32} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <Field id="r-pw" label="Senha" error={pwError}><input id="r-pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required /></Field>
        <Field id="r-pw2" label="Confirmar senha" error={confirmError}><input id="r-pw2" type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></Field>
        {error && <div className="error-text" role="alert">{error}</div>}
        <button className="btn btn-primary h-10" disabled={!canSubmit}>{busy ? <Spinner size={16} /> : 'Continuar'}</button>
      </form>
    </AuthLayout>
  )
}

/* -------------------------------------------------------------- Recuperação */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!isConfigured) return <NotConfiguredPage />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${appOrigin()}/reset-password` })
    setBusy(false)
    if (error) setError(errorMessage(error))
    else setDone(true)
  }

  return (
    <AuthLayout title="Recuperar senha" subtitle="Enviaremos um link para redefinir sua senha." footer={<Link to="/login">Voltar ao login</Link>}>
      {done ? (
        <div className="flex flex-col items-center gap-2 text-center text-fg-2">
          <MailCheck size={36} className="text-success" />
          <p className="m-0">Se existir uma conta com <strong>{email}</strong>, o e-mail de recuperação foi enviado.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field id="f-email" label="E-mail"><input id="f-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="email" /></Field>
          {error && <div className="error-text" role="alert">{error}</div>}
          <button className="btn btn-primary h-10" disabled={busy || !email}>{busy ? <Spinner size={16} /> : 'Enviar link'}</button>
        </form>
      )}
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const nav = useNavigate()
  const { session, phase, clearRecovery } = useSession()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [params] = useSearchParams()
  const [timedOut, setTimedOut] = useState(false)

  // Com PKCE o link traz ?code=…; o supabase-js troca por sessão automaticamente.
  const hasCode = params.has('code') || window.location.hash.includes('access_token')
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 6000)
    return () => clearTimeout(t)
  }, [])
  const waiting = !timedOut && (phase === 'loading' || (!session && hasCode))
  if (!isConfigured) return <NotConfiguredPage />
  if (waiting) return <CenterSpinner label="Validando link…" />
  if (!session)
    return (
      <AuthLayout title="Link inválido ou expirado" footer={<Link to="/forgot">Solicitar novo link</Link>}>
        <p className="m-0 text-fg-2">Este link de recuperação não é mais válido. Solicite um novo.</p>
      </AuthLayout>
    )

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (pw !== pw2) return setError('As senhas não coincidem.')
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    clearRecovery()
    toast.success('Senha redefinida com sucesso.')
    nav('/app', { replace: true })
  }

  return (
    <AuthLayout title="Definir nova senha">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id="n-pw" label="Nova senha" hint="Mínimo de 8 caracteres."><input id="n-pw" type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoFocus autoComplete="new-password" /></Field>
        <Field id="n-pw2" label="Confirmar nova senha"><input id="n-pw2" type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={8} required autoComplete="new-password" /></Field>
        {error && <div className="error-text" role="alert">{error}</div>}
        <button className="btn btn-primary h-10" disabled={busy || pw.length < 8}>{busy ? <Spinner size={16} /> : 'Salvar nova senha'}</button>
      </form>
    </AuthLayout>
  )
}

/* ------------------------------------------------------------ Primeiro acesso */
export function OnboardingPage() {
  const nav = useNavigate()
  const { profile, user, setProfile } = useSession()
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [username, setUsername] = useState(profile?.username ?? '')
  const [avatarPath, setAvatarPath] = useState<string | null>(profile?.avatar_path ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<'ok' | 'taken' | 'invalid' | 'checking'>('ok')
  const fileRef = useRef<HTMLInputElement>(null)
  const [params] = useSearchParams()

  const uname = username.trim().toLowerCase()
  useEffect(() => {
    if (!profile || uname === profile.username) return setState('ok')
    if (!/^[a-z0-9_.]{2,32}$/.test(uname)) return setState('invalid')
    setState('checking')
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('username_available', { p_username: uname })
      setState(data ? 'ok' : 'taken')
    }, 400)
    return () => clearTimeout(t)
  }, [uname, profile])

  if (!profile || !user) return <CenterSpinner />

  const pick = async (file: File | undefined) => {
    if (!file) return
    try {
      const old = avatarPath
      const path = await uploadPublicImage('avatars', user.id, file)
      setAvatarPath(path)
      if (old && old !== profile.avatar_path) void removePublicFile(old)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (state !== 'ok') return
    setBusy(true)
    setError(null)
    const { data, error } = await supabase
      .from('profiles')
      .update({ username: uname, display_name: displayName.trim() || uname, avatar_path: avatarPath, onboarded: true })
      .eq('id', user.id)
      .select()
      .single()
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setProfile(data)
    nav(params.get('next') || '/app', { replace: true })
  }

  return (
    <AuthLayout title="Vamos configurar seu perfil" subtitle="Como seus amigos vão ver você.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex justify-center">
          <button type="button" className="group relative rounded-full" onClick={() => fileRef.current?.click()} aria-label="Escolher foto de perfil">
            <Avatar path={avatarPath} name={displayName || uname} id={user.id} size={88} />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><Camera /></span>
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        </div>
        <Field id="o-name" label="Nome de exibição"><input id="o-name" className="input" maxLength={32} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus /></Field>
        <Field id="o-user" label="Nome de usuário" error={state === 'taken' ? 'Já está em uso.' : state === 'invalid' ? 'Use 2–32 letras minúsculas, números, "_" ou ".".' : null}>
          <input id="o-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={state === 'taken' || state === 'invalid'} />
        </Field>
        {error && <div className="error-text" role="alert">{error}</div>}
        <button className="btn btn-primary h-10" disabled={busy || state !== 'ok'}>{busy ? <Spinner size={16} /> : 'Concluir'}</button>
      </form>
    </AuthLayout>
  )
}

/* ------------------------------------------------------- Conta desativada */
export function DisabledAccountPage() {
  const signOut = useSession((s) => s.signOut)
  const loadProfile = useSession((s) => s.loadProfile)
  const [busy, setBusy] = useState(false)
  const reactivate = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('reactivate_account')
    setBusy(false)
    if (error) return toast.error(errorMessage(error))
    await loadProfile()
    toast.success('Conta reativada.')
  }
  return (
    <AuthLayout title="Conta desativada" subtitle="Sua conta está desativada e invisível para os outros.">
      <div className="flex flex-col gap-2">
        <button className="btn btn-primary h-10" onClick={reactivate} disabled={busy}>{busy ? <Spinner size={16} /> : 'Reativar minha conta'}</button>
        <button className="btn btn-ghost" onClick={() => void signOut()}>Sair</button>
      </div>
    </AuthLayout>
  )
}

/* -------------------------------------------------------- Guarda de rotas */
export function RequireAuth({ children }: { children: ReactNode }) {
  const phase = useSession((s) => s.phase)
  const profile = useSession((s) => s.profile)
  const loc = useLocation()
  if (!isConfigured) return <NotConfiguredPage />
  if (phase === 'loading') return <CenterSpinner label="Carregando…" />
  if (phase === 'signedOut') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (phase === 'disabled') return <DisabledAccountPage />
  if (profile && !profile.onboarded && loc.pathname !== '/welcome') return <Navigate to={`/welcome?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return <>{children}</>
}
