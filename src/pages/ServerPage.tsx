import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, Hash, Lock, Users, Volume2 } from 'lucide-react'
import { useChannels, useServers } from '@/data/queries'
import { useSettings } from '@/store/settings'
import { useUI } from '@/store/ui'
import { CenterSpinner, EmptyState, IconButton } from '@/components/ui'
import { ChatView } from '@/components/chat/ChatView'
import { useServerChatCtx } from '@/components/chat/useChatCtx'
import { VoiceStage } from '@/components/voice/VoiceStage'
import { MemberList } from '@/components/shell/MemberList'
import type { Channel } from '@/lib/types'

const LAST_KEY = 'vibe.lastChannel'

function lastChannel(serverId: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, string>)[serverId] ?? null
  } catch {
    return null
  }
}

function TextChannel({ serverId, channel, membersOpen, toggleMembers }: { serverId: string; channel: Channel; membersOpen: boolean; toggleMembers: () => void }) {
  const ctx = useServerChatCtx(serverId, channel.id)
  const setMobilePane = useUI((s) => s.setMobilePane)
  const [panel, setPanel] = useState<'pins' | 'search' | null>(null)
  useEffect(() => setPanel(null), [channel.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setPanel('search')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <ChatView
      ctx={ctx}
      placeholder={`Conversar em #${channel.name}`}
      panel={panel}
      onPanelChange={setPanel}
      header={(tools) => (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 shadow-sm">
          <IconButton label="Voltar" className="md:hidden" onClick={() => setMobilePane('nav')}><ArrowLeft size={20} /></IconButton>
          {channel.is_private ? <Lock size={20} className="shrink-0 text-fg-muted" /> : <Hash size={22} className="shrink-0 text-fg-muted" />}
          <h1 className="m-0 truncate text-base font-bold">{channel.name}</h1>
          {channel.topic && <><span className="h-5 w-px bg-[var(--border-strong)] max-sm:hidden" /><span className="min-w-0 flex-1 truncate text-fg-2 max-sm:hidden" title={channel.topic}>{channel.topic}</span></>}
          <span className="flex-1" />
          {tools.pins()}
          <IconButton label="Lista de membros" aria-pressed={membersOpen} onClick={toggleMembers}><Users size={20} /></IconButton>
          {tools.search()}
        </header>
      )}
    />
  )
}

export function ServerPage() {
  const { serverId = '', channelId } = useParams()
  const { data: servers, isLoading: loadingServers } = useServers()
  const { data: channels, isLoading } = useChannels(serverId)
  const showMembers = useSettings((s) => s.settings.showMembers)
  const update = useSettings((s) => s.update)
  const { mobilePane, setMobilePane, setActive } = useUI()

  const channel = channels?.find((c) => c.id === channelId)
  useEffect(() => {
    setActive({ channelId: channel?.kind === 'text' ? channel.id : null })
    if (channel) {
      try {
        const cur = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, string>
        cur[serverId] = channel.id
        localStorage.setItem(LAST_KEY, JSON.stringify(cur))
      } catch { /* sem storage */ }
    }
    return () => setActive({ channelId: null })
  }, [channel, serverId, setActive])

  if (loadingServers || isLoading) return <CenterSpinner />
  if (!servers?.some((s) => s.id === serverId)) return <Navigate to="/app/@me" replace />
  if (!channels?.length) return <div className="grid h-full place-items-center bg-primary"><EmptyState icon={<Hash />} title="Nenhum canal disponível">Você não tem acesso a nenhum canal neste servidor, ou ele ainda não tem canais.</EmptyState></div>
  if (!channel) {
    const remembered = lastChannel(serverId)
    const target = channels.find((c) => c.id === remembered) ?? channels.find((c) => c.kind === 'text') ?? channels[0]
    return <Navigate to={`/app/s/${serverId}/${target.id}`} replace />
  }

  const membersOpen = showMembers
  const toggleMembers = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) update({ showMembers: !showMembers })
    else setMobilePane(mobilePane === 'members' ? 'main' : 'members')
  }

  return (
    <div className="flex h-full min-w-0">
      <main className={`min-w-0 flex-1 ${mobilePane === 'members' ? 'max-lg:hidden' : ''}`}>
        {channel.kind === 'text' ? (
          <TextChannel serverId={serverId} channel={channel} membersOpen={membersOpen || mobilePane === 'members'} toggleMembers={toggleMembers} />
        ) : (
          <div className="flex h-full flex-col bg-primary">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 shadow-sm">
              <IconButton label="Voltar" className="md:hidden" onClick={() => setMobilePane('nav')}><ArrowLeft size={20} /></IconButton>
              <Volume2 size={20} className="text-fg-muted" /><h1 className="m-0 text-base font-bold">{channel.name}</h1>
              <span className="flex-1" />
              <IconButton label="Lista de membros" aria-pressed={membersOpen} onClick={toggleMembers}><Users size={20} /></IconButton>
            </header>
            <div className="min-h-0 flex-1"><VoiceStage channel={channel} serverId={serverId} /></div>
          </div>
        )}
      </main>
      {(membersOpen || mobilePane === 'members') && (
        <aside className={`w-[var(--members-width)] shrink-0 border-l border-border ${mobilePane === 'members' ? 'max-lg:!w-full' : 'max-lg:hidden'}`}>
          <MemberList serverId={serverId} />
        </aside>
      )}
    </div>
  )
}
