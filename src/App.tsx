import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSession } from '@/store/session'
import { isTauri } from '@/lib/env'
import { ContextMenuHost, ModalHost, ToastHost, TooltipHost } from '@/components/ui'
import { ProfileCardHost } from '@/components/ProfileCard'
import { ForgotPasswordPage, LoginPage, OnboardingPage, RegisterPage, RequireAuth, ResetPasswordPage } from '@/pages/Auth'
import { AppShell } from '@/pages/AppShell'
import { DmPage, FriendsPage } from '@/pages/HomePages'
import { ServerPage } from '@/pages/ServerPage'
import { InvitePage } from '@/pages/InvitePage'
import { DownloadPage } from '@/pages/DownloadPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

function SessionBoot() {
  const init = useSession((s) => s.init)
  useEffect(() => init(), [init])

  // App desktop: sem menu nativo do navegador (Voltar/Atualizar/Salvar como…). Campos de texto mantêm copiar/colar.
  useEffect(() => {
    if (!isTauri) return
    const onMenu = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'u'].includes(e.key.toLowerCase())) e.preventDefault()
    }
    // links externos (http/https) abrem no navegador padrão, não dentro do app
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('a[href]')
      if (!a || !/^https?:\/\//i.test(a.href) || a.origin === window.location.origin) return
      e.preventDefault()
      void import('@tauri-apps/plugin-opener').then((m) => m.openUrl(a.href))
    }
    document.addEventListener('contextmenu', onMenu)
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('contextmenu', onMenu)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onClick)
    }
  }, [])
  return null
}

function Home() {
  const phase = useSession((s) => s.phase)
  if (isTauri || phase === 'ready') return <Navigate to="/app/@me" replace />
  return <DownloadPage />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionBoot />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/download" element={<DownloadPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/invite/:code" element={<InvitePage />} />
          <Route path="/welcome" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
          <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route index element={<Navigate to="/app/@me" replace />} />
            <Route path="@me" element={<FriendsPage />} />
            <Route path="@me/:dmId" element={<DmPage />} />
            <Route path="s/:serverId" element={<ServerPage />} />
            <Route path="s/:serverId/:channelId" element={<ServerPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/app/@me" replace />} />
        </Routes>
        <ModalHost />
        <ContextMenuHost />
        <ProfileCardHost />
        <ToastHost />
        <TooltipHost />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
