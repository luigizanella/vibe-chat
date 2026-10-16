import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Activity, AppWindow, Ban, Bell, Keyboard, Link2, LogOut, Lock, Mic, Monitor, Palette, Radio, Search, Shield, User, UserCog, Volume2, X } from 'lucide-react'
import { useSession } from '@/store/session'
import { Avatar, useCloseModal } from '@/components/ui'
import { AccountTab, BlockedTab, PrivacyTab, ProfileTab, SecurityTab, SoonTab } from './AccountTabs'
import { AppearanceTab, DesktopTab, DiagnosticsTab, KeybindsTab, NotificationsTab, SoundsTab } from './AppTabs'
import { VoiceTab } from './VoiceTab'

export type UserTab =
  | 'profile' | 'account' | 'security' | 'status' | 'connections' | 'privacy' | 'blocked' | 'apps'
  | 'appearance' | 'notifications' | 'keybinds' | 'desktop' | 'voice' | 'sounds' | 'diagnostics'

interface NavItem { id: UserTab; label: string; icon: ReactNode; soon?: boolean }
interface NavGroup { title: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    title: 'Configurações do usuário',
    items: [
      { id: 'account', label: 'Conta', icon: <UserCog size={16} /> },
      { id: 'profile', label: 'Perfil', icon: <User size={16} /> },
      { id: 'security', label: 'Senha e segurança', icon: <Lock size={16} /> },
      { id: 'status', label: 'Status e atividade', icon: <Radio size={16} />, soon: true },
      { id: 'connections', label: 'Conexões', icon: <Link2 size={16} />, soon: true },
      { id: 'privacy', label: 'Privacidade', icon: <Shield size={16} /> },
      { id: 'blocked', label: 'Usuários bloqueados', icon: <Ban size={16} /> },
      { id: 'apps', label: 'Apps autorizados', icon: <AppWindow size={16} />, soon: true },
    ],
  },
  {
    title: 'Configurações do app',
    items: [
      { id: 'appearance', label: 'Aparência', icon: <Palette size={16} /> },
      { id: 'notifications', label: 'Notificações', icon: <Bell size={16} /> },
      { id: 'keybinds', label: 'Atalhos', icon: <Keyboard size={16} /> },
      { id: 'desktop', label: 'Aplicativo', icon: <Monitor size={16} /> },
      { id: 'voice', label: 'Voz e vídeo', icon: <Mic size={16} /> },
      { id: 'sounds', label: 'Sons', icon: <Volume2 size={16} /> },
      { id: 'diagnostics', label: 'Diagnóstico', icon: <Activity size={16} /> },
    ],
  },
]

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function UserSettingsModal({ initialTab = 'account' }: { initialTab?: UserTab }) {
  const [tab, setTab] = useState<UserTab>(initialTab)
  const [q, setQ] = useState('')
  const profile = useSession((s) => s.profile)
  const signOut = useSession((s) => s.signOut)
  const close = useCloseModal()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => ref.current?.showModal(), [])

  const groups = useMemo(() => {
    const n = norm(q.trim())
    return GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !n || norm(i.label).includes(n)) })).filter((g) => g.items.length)
  }, [q])
  const current = GROUPS.flatMap((g) => g.items).find((i) => i.id === tab)

  const content = (() => {
    switch (tab) {
      case 'profile': return <ProfileTab />
      case 'account': return <AccountTab />
      case 'security': return <SecurityTab />
      case 'status': return <SoonTab title="Status e atividade">Em breve você poderá escolher quem vê o que você está jogando ou ouvindo. Por enquanto, mude o seu status no painel do usuário.</SoonTab>
      case 'connections': return <SoonTab title="Conexões">Ligação com outras contas (música, jogos) ainda não existe nesta versão.</SoonTab>
      case 'privacy': return <PrivacyTab />
      case 'blocked': return <BlockedTab />
      case 'apps': return <SoonTab title="Apps autorizados">Aplicativos de terceiros ainda não podem acessar a sua conta.</SoonTab>
      case 'appearance': return <AppearanceTab />
      case 'notifications': return <NotificationsTab />
      case 'keybinds': return <KeybindsTab />
      case 'desktop': return <DesktopTab />
      case 'voice': return <VoiceTab />
      case 'sounds': return <SoundsTab />
      case 'diagnostics': return <DiagnosticsTab />
    }
  })()

  return (
    <dialog ref={ref} className="modal" data-size="lg" style={{ maxWidth: 'min(96vw, 980px)', height: 'min(92vh, 720px)' }} onClose={close} onCancel={(e) => { e.preventDefault(); close() }} aria-label="Configurações">
      <div className="flex h-full bg-primary text-fg max-sm:flex-col">
        <nav className="flex shrink-0 flex-col gap-1 overflow-y-auto border-b border-border bg-secondary p-3 sm:w-64 sm:border-r sm:border-b-0" aria-label="Configurações">
          {profile && (
            <div className="mb-2 flex items-center gap-3 rounded-lg bg-[var(--bg-primary)] p-2.5">
              <Avatar path={profile.avatar_path} name={profile.display_name || profile.username} id={profile.id} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{profile.display_name || profile.username}</div>
                <button className="border-0 bg-transparent p-0 text-xs text-[var(--text-link)] hover:underline" onClick={() => { setQ(''); setTab('profile') }}>Editar perfis</button>
              </div>
            </div>
          )}
          <div className="relative mb-1">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted" aria-hidden />
            <input className="input h-8 pl-8 text-sm" placeholder="Buscar" aria-label="Buscar nas configurações" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {groups.map((g) => (
            <div key={g.title} className="mt-2">
              <div className="mb-1 px-2 text-xs font-bold text-fg-muted">{g.title}</div>
              {g.items.map((i) => (
                <button key={i.id} onClick={() => setTab(i.id)} aria-current={tab === i.id} className={clsx('flex w-full items-center gap-2 rounded-md border-0 px-2.5 py-1.5 text-left font-medium', tab === i.id ? 'bg-[var(--bg-selected)] text-fg' : 'bg-transparent text-fg-2 hover:bg-[var(--bg-hover)]')}>
                  {i.icon}<span className="min-w-0 flex-1 truncate">{i.label}</span>
                  {i.soon && <span className="rounded bg-tertiary px-1.5 text-[10px] leading-4 text-fg-muted">em breve</span>}
                </button>
              ))}
            </div>
          ))}
          {!groups.length && <p className="px-2 text-sm text-fg-muted">Nada encontrado.</p>}
          <div className="my-2 h-px bg-[var(--border)]" />
          <button onClick={() => { close(); void signOut() }} className="flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left font-medium text-[var(--danger-text)] hover:bg-[var(--bg-hover)]">
            <LogOut size={16} />Sair
          </button>
        </nav>
        <section className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-primary p-5 text-fg sm:p-8" aria-label={current?.label}>
          <button className="icon-btn absolute top-3 right-3" onClick={close} aria-label="Fechar" data-tip="Fechar (Esc)"><X size={20} /></button>
          {content}
        </section>
      </div>
    </dialog>
  )
}
