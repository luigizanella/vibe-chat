import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSession } from '@/store/session'
import { ContextMenuHost, ModalHost, ToastHost, TooltipHost } from '@/components/ui'
import { ProfileCardHost } from '@/components/ProfileCard'
import { ForgotPasswordPage, LoginPage, OnboardingPage, RegisterPage, RequireAuth, ResetPasswordPage } from '@/pages/Auth'
import { AppShell } from '@/pages/AppShell'
import { DmPage, FriendsPage } from '@/pages/HomePages'
import { ServerPage } from '@/pages/ServerPage'
import { InvitePage } from '@/pages/InvitePage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

function SessionBoot() {
  const init = useSession((s) => s.init)
  useEffect(() => init(), [init])
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionBoot />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/app/@me" replace />} />
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
