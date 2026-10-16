import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bell, Hash, MessageSquare, Volume2, WifiOff, X } from 'lucide-react'
import { useRealtimeSync } from '@/data/realtime'
import { usePresenceManager } from '@/data/presence'
import { useVoiceModeration } from '@/data/voiceModeration'
import { MusicHost } from '@/components/music/MusicHost'
import { qk, useDMs, useFriends, useServers, useUnread } from '@/data/queries'
import { useSession } from '@/store/session'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'
import { useVoice } from '@/store/voice'
import { matchCombo, isTypingTarget } from '@/lib/keys'
import { notificationPermission, requestNotificationPermission, setUnreadTitle } from '@/lib/notify'
import { rpc } from '@/lib/supabase'
import { isTauri } from '@/lib/env'
import { startAutoUpdate } from '@/lib/updater'
import { UpdateBanner } from '@/components/UpdateBanner'
import { Avatar, Modal, useCloseModal } from '@/components/ui'
import { ServerRail } from '@/components/shell/ServerRail'
import { ChannelSidebar } from '@/components/shell/ChannelSidebar'
import { HomeSidebar, dmTitle } from './HomePages'
import { KeybindsTab } from '@/components/settings/AppTabs'
import type { Channel } from '@/lib/types'

/* ------------------------------------------------------------ atalhos globais */
function useGlobalKeybinds() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { serverId, channelId } = useParams()

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const { settings } = useSettings.getState()
      const voice = useVoice.getState()
      const kb = settings.keybinds

      if (settings.voice.pttEnabled && voice.room && e.code === kb.pushToTalk && !e.repeat) {
        voice.setPtt(true)
        if (e.key.length > 1 || e.ctrlKey || e.altKey) e.preventDefault()
        else if (!isTypingTarget(e.target)) e.preventDefault()
        return
      }
      if (matchCombo(e, kb.toggleMute) && voice.room) { e.preventDefault(); void voice.toggleMic(); return }
      if (matchCombo(e, kb.toggleDeafen) && voice.room) { e.preventDefault(); void voice.toggleDeafen(); return }
      if (matchCombo(e, kb.quickSwitcher)) { e.preventDefault(); useUI.getState().setQuickSwitcher(true); return }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); useUI.getState().openModal(<HelpModal />); return }

      // navegação entre canais / servidores
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && serverId) {
        const chans = qc.getQueryData<Channel[]>(qk.channels(serverId)) ?? []
        const sorted = [...chans].sort((a, b) => a.position - b.position)
        const i = sorted.findIndex((c) => c.id === channelId)
        const next = sorted[(i + (e.key === 'ArrowDown' ? 1 : -1) + sorted.length) % sorted.length]
        if (next && sorted.length) { e.preventDefault(); nav(`/app/s/${serverId}/${next.id}`) }
      }
      if (e.ctrlKey && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const servers = qc.getQueryData<{ id: string }[]>(qk.servers) ?? []
        const list = ['@me', ...servers.map((s) => s.id)]
        const i = list.indexOf(serverId ?? '@me')
        const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]
        e.preventDefault()
        nav(next === '@me' ? '/app/@me' : `/app/s/${next}`)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === useSettings.getState().settings.keybinds.pushToTalk) useVoice.getState().setPtt(false)
    }
    const blur = () => useVoice.getState().setPtt(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [nav, qc, serverId, channelId])
}

/* ---------------------------------------------------------- Busca rápida */
function QuickSwitcher() {
  const open = useUI((s) => s.quickSwitcherOpen)
  const setOpen = useUI((s) => s.setQuickSwitcher)
  if (!open) return null
  return <QuickSwitcherInner onClose={() => setOpen(false)} />
}

function QuickSwitcherInner({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const nav = useNavigate()
  const me = useSession((s) => s.user!.id)
  const { data: servers } = useServers()
  const { data: dms } = useDMs()
  const { data: friends } = useFriends()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const setMobilePane = useUI((s) => s.setMobilePane)

  const items = useMemo(() => {
    const out: { key: string; label: string; sub: string; icon: React.ReactNode; go: () => void }[] = []
    for (const s of servers ?? []) {
      for (const c of qc.getQueryData<Channel[]>(qk.channels(s.id)) ?? [])
        out.push({ key: c.id, label: c.name, sub: s.name, icon: c.kind === 'voice' ? <Volume2 size={16} /> : <Hash size={16} />, go: () => nav(`/app/s/${s.id}/${c.id}`) })
    }
    for (const d of dms ?? []) {
      const t = dmTitle(d, me)
      out.push({ key: d.id, label: t.name, sub: 'Mensagem direta', icon: <MessageSquare size={16} />, go: () => nav(`/app/@me/${d.id}`) })
    }
    for (const f of friends?.filter((x) => x.status === 'friend') ?? []) {
      out.push({ key: `f${f.other.id}`, label: f.other.display_name || f.other.username, sub: `@${f.other.username} • amigo`, icon: <Avatar path={f.other.avatar_path} name={f.other.display_name} id={f.other.id} size={18} />, go: () => void rpc<string>('open_dm', { p_user: f.other.id }).then((id) => nav(`/app/@me/${id}`)) })
    }
    const needle = q.trim().toLowerCase()
    return out.filter((i) => !needle || `${i.label} ${i.sub}`.toLowerCase().includes(needle)).slice(0, 30)
  }, [servers, dms, friends, q, qc, nav, me])

  const choose = (i: number) => {
    items[i]?.go()
    setMobilePane('main')
    onClose()
  }

  return (
    <QuickModal onClose={onClose}>
      <input className="input mb-2" autoFocus placeholder="Para onde você quer ir?" value={q} aria-label="Busca rápida" onChange={(e) => { setQ(e.target.value); setIdx(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
          if (e.key === 'Enter') choose(idx)
        }} />
      <div role="listbox" className="max-h-72 overflow-y-auto">
        {items.map((it, i) => (
          <button key={it.key} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => choose(i)} className="flex w-full items-center gap-3 rounded-md border-0 px-3 py-2 text-left" style={{ background: i === idx ? 'var(--bg-selected)' : 'transparent' }}>
            <span className="text-fg-muted">{it.icon}</span><span className="font-semibold">{it.label}</span><span className="ml-auto text-xs text-fg-muted">{it.sub}</span>
          </button>
        ))}
        {!items.length && <p className="p-4 text-center text-fg-muted">Nada encontrado.</p>}
      </div>
    </QuickModal>
  )
}

function QuickModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 grid place-items-start justify-center bg-[var(--scrim)] p-4 pt-[12vh]" style={{ zIndex: 'var(--z-modal)' as unknown as number, animation: 'fade-in var(--dur)' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()} role="dialog" aria-modal="true" aria-label="Busca rápida">
      <div className="w-full max-w-lg rounded-xl border border-border bg-primary p-3 shadow-[var(--shadow)]" style={{ animation: 'pop-in var(--dur) var(--ease)' }}>{children}</div>
    </div>
  )
}

export function HelpModal() {
  const close = useCloseModal()
  return (
    <Modal title="Ajuda e atalhos" size="lg" footer={<button className="btn btn-primary" onClick={close}>Fechar</button>}>
      <KeybindsTab />
    </Modal>
  )
}

/* ------------------------------------------------------------------ Faixas */
function Banners() {
  const [online, setOnline] = useState(navigator.onLine)
  const [perm, setPerm] = useState<string>('granted')
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('vibe.notifPrompt') === '1')
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    void notificationPermission().then(setPerm)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return (
    <>
      {!online && <div className="flex items-center justify-center gap-2 bg-warning px-3 py-1.5 text-sm font-semibold text-black" role="alert"><WifiOff size={15} /> Sem conexão — tentando reconectar…</div>}
      {online && perm === 'default' && !dismissed && (
        <div className="flex items-center justify-center gap-3 bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent-contrast)]">
          <Bell size={15} /> Receba avisos de mensagens e menções mesmo com o app em segundo plano.
          <button className="btn btn-sm" onClick={() => void requestNotificationPermission().then((p) => { setPerm(p); localStorage.setItem('vibe.notifPrompt', '1') })}>Ativar</button>
          <button className="icon-btn h-6 w-6 text-[var(--accent-contrast)]" aria-label="Dispensar" onClick={() => { localStorage.setItem('vibe.notifPrompt', '1'); setDismissed(true) }}><X size={14} /></button>
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------- Shell */
export function AppShell() {
  useRealtimeSync()
  useVoiceModeration()
  usePresenceManager()
  useGlobalKeybinds()
  const { serverId } = useParams()
  const loc = useLocation()
  const mobilePane = useUI((s) => s.mobilePane)
  const setMobilePane = useUI((s) => s.setMobilePane)
  const setQuick = useUI((s) => s.setQuickSwitcher)
  const openModal = useUI((s) => s.openModal)
  const { data: unread } = useUnread()

  // aplicativo desktop: sincroniza a preferência de bandeja com o processo Rust
  const closeToTray = useSettings((s) => s.settings.desktop.closeToTray)
  useEffect(() => {
    if (!isTauri) return
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_close_to_tray', { enabled: closeToTray })).catch(() => undefined)
  }, [closeToTray])

  // atualização automática: ao abrir e periodicamente (desktop: instala; web: recarrega)
  useEffect(() => startAutoUpdate(), [])

  // contador de não lidas no título da janela
  useEffect(() => {
    setUnreadTitle((unread ?? []).reduce((a, u) => a + (u.mention_count || (u.unread_count ? 1 : 0)), 0))
  }, [unread])

  // ao navegar para um canal/conversa por link (convite, notificação), mostrar o conteúdo no mobile
  useEffect(() => {
    const parts = loc.pathname.split('/').filter(Boolean)
    if (parts.length >= 4) setMobilePane('main')
  }, [loc.pathname, setMobilePane])

  return (
    <div className="flex h-full flex-col bg-primary">
      <Banners />
      <div className="flex min-h-0 flex-1">
        <div className={clsx('flex shrink-0', mobilePane === 'nav' ? 'max-md:w-full' : 'max-md:hidden')}>
          <div className="relative w-[var(--rail-width)] shrink-0">
            <ServerRail onHelp={() => openModal(<HelpModal />)} />
          </div>
          <div className="w-[var(--sidebar-width)] min-w-0 max-md:flex-1 md:shrink-0">{serverId ? <ChannelSidebar key={serverId} serverId={serverId} /> : <HomeSidebar />}</div>
        </div>
        <div className={clsx('min-w-0 flex-1', mobilePane === 'nav' && 'max-md:hidden')}><Outlet /></div>
      </div>
      <QuickSwitcher />
      <MusicHost />
      <UpdateBanner />
    </div>
  )
}
