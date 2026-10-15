import { useState, type ReactNode } from 'react'
import { Activity, Bell, Keyboard, LogOut, Monitor, Mic, Palette, Shield, User, UserCog } from 'lucide-react'
import { useSession } from '@/store/session'
import { useCloseModal } from '@/components/ui'
import { SettingsFrame } from '@/components/modals/ServerSettings'
import { AccountTab, PrivacyTab, ProfileTab } from './AccountTabs'
import { AppearanceTab, DesktopTab, DiagnosticsTab, KeybindsTab, NotificationsTab } from './AppTabs'
import { VoiceTab } from './VoiceTab'

export type UserTab = 'profile' | 'account' | 'privacy' | 'appearance' | 'notifications' | 'voice' | 'keybinds' | 'desktop' | 'diagnostics'

export function UserSettingsModal({ initialTab = 'profile' }: { initialTab?: UserTab }) {
  const [tab, setTab] = useState<UserTab>(initialTab)
  const signOut = useSession((s) => s.signOut)
  const close = useCloseModal()
  const tabs: { id: UserTab; label: string; icon: ReactNode }[] = [
    { id: 'profile', label: 'Meu perfil', icon: <User size={16} /> },
    { id: 'account', label: 'Conta', icon: <UserCog size={16} /> },
    { id: 'privacy', label: 'Privacidade', icon: <Shield size={16} /> },
    { id: 'appearance', label: 'Aparência', icon: <Palette size={16} /> },
    { id: 'notifications', label: 'Notificações', icon: <Bell size={16} /> },
    { id: 'voice', label: 'Voz e vídeo', icon: <Mic size={16} /> },
    { id: 'keybinds', label: 'Atalhos', icon: <Keyboard size={16} /> },
    { id: 'desktop', label: 'Aplicativo', icon: <Monitor size={16} /> },
    { id: 'diagnostics', label: 'Diagnóstico', icon: <Activity size={16} /> },
  ]
  return (
    <SettingsFrame title="Configurações" tabs={[...tabs, { id: 'logout' as UserTab, label: 'Sair', icon: <LogOut size={16} /> }]} tab={tab} setTab={((t: UserTab | 'logout') => { if (t === 'logout') { close(); void signOut() } else setTab(t) }) as never}>
      {tab === 'profile' && <ProfileTab />}
      {tab === 'account' && <AccountTab />}
      {tab === 'privacy' && <PrivacyTab />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'voice' && <VoiceTab />}
      {tab === 'keybinds' && <KeybindsTab />}
      {tab === 'desktop' && <DesktopTab />}
      {tab === 'diagnostics' && <DiagnosticsTab />}
    </SettingsFrame>
  )
}
