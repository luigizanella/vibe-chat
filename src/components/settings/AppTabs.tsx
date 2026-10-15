import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { env, isTauri } from '@/lib/env'
import { APP_VERSION, BUILD_TIME } from '@/lib/types'
import { codeLabel, comboFromEvent, isModifierKey } from '@/lib/keys'
import { notificationPermission, requestNotificationPermission, type NotifPermission } from '@/lib/notify'
import { playSound } from '@/lib/sounds'
import { useSettings } from '@/store/settings'
import { toast } from '@/store/ui'
import { fetchVoiceToken } from '@/store/voice'
import { checkForUpdate } from '@/lib/updater'
import { qk, useNotifPrefs, useServers } from '@/data/queries'
import { SettingRow, Toggle, Spinner } from '@/components/ui'
import { errorMessage } from '@/lib/errors'

const H = ({ children }: { children: React.ReactNode }) => <h2 className="mt-0 mb-5 text-xl font-bold">{children}</h2>
const ACCENTS = ['#7c6cff', '#4aa3ff', '#3ba55d', '#f0b232', '#ed7b42', '#ed4245', '#e05db0', '#2cc4c4']

export function AppearanceTab() {
  const { settings, update } = useSettings()
  return (
    <div className="max-w-xl">
      <H>Aparência</H>
      <div className="label mb-2">Tema</div>
      <div className="mb-6 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tema">
        {([['dark', 'Escuro'], ['light', 'Claro'], ['system', 'Sistema']] as const).map(([v, l]) => (
          <button key={v} role="radio" aria-checked={settings.theme === v} onClick={() => update({ theme: v })} className={clsx('rounded-md border p-3 font-semibold', settings.theme === v ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-border bg-secondary')}>{l}</button>
        ))}
      </div>
      <div className="label mb-2">Cor de destaque</div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {ACCENTS.map((c) => (
          <button key={c} aria-label={`Cor ${c}`} aria-pressed={settings.accent === c} onClick={() => update({ accent: c })} className="h-8 w-8 rounded-full border-2" style={{ background: c, borderColor: settings.accent === c ? 'var(--text-primary)' : 'transparent' }} />
        ))}
        <label className="ml-2 flex items-center gap-2 text-fg-2">Personalizada <input type="color" value={settings.accent} onChange={(e) => update({ accent: e.target.value })} aria-label="Cor personalizada" className="h-8 w-10 cursor-pointer border-0 bg-transparent p-0" /></label>
      </div>
      <div className="field mb-6"><label htmlFor="scale">Escala da interface: {Math.round(settings.scale * 100)}%</label>
        <input id="scale" type="range" min={0.85} max={1.3} step={0.05} value={settings.scale} onChange={(e) => update({ scale: Number(e.target.value) })} /></div>
      <SettingRow title="Modo compacto" description="Reduz o espaçamento das mensagens e listas."><Toggle checked={settings.compact} onChange={(v) => update({ compact: v })} label="Modo compacto" /></SettingRow>
      <SettingRow title="Idioma" description="Apenas Português (Brasil) está disponível nesta versão; a tradução para outros idiomas ainda não foi implementada.">
        <select className="select w-44" value="pt-BR" onChange={() => undefined} aria-label="Idioma"><option value="pt-BR">Português (Brasil)</option><option disabled>English — indisponível</option></select>
      </SettingRow>
    </div>
  )
}

export function NotificationsTab() {
  const { settings, update } = useSettings()
  const qc = useQueryClient()
  const { data: prefs } = useNotifPrefs()
  const { data: servers } = useServers()
  const [perm, setPerm] = useState<NotifPermission>('default')
  useEffect(() => void notificationPermission().then(setPerm), [])
  const n = settings.notifications
  const s = settings.sounds
  const removePref = async (id: string) => {
    const { error } = await supabase.from('notification_prefs').delete().eq('id', id)
    if (error) return toast.error(errorMessage(error))
    await qc.invalidateQueries({ queryKey: qk.notifPrefs })
  }
  const muted = (prefs ?? []).filter((p) => p.muted || p.level !== 'all')
  return (
    <div className="max-w-xl">
      <H>Notificações</H>
      <SettingRow title="Notificações do sistema" description={perm === 'granted' ? 'Autorizadas. Aparecem quando o app não está em foco.' : perm === 'denied' ? 'Bloqueadas no navegador/sistema. Libere nas configurações do site.' : perm === 'unsupported' ? 'Não suportadas neste ambiente.' : 'Ainda não autorizadas.'}>
        {perm === 'default' ? <button className="btn btn-primary btn-sm" onClick={() => void requestNotificationPermission().then(setPerm)}>Autorizar</button> : <Toggle checked={n.desktop && perm === 'granted'} disabled={perm !== 'granted'} onChange={(v) => update({ notifications: { ...n, desktop: v } })} label="Notificações do sistema" />}
      </SettingRow>
      <SettingRow title="Somente menções nos servidores" description="Mensagens diretas sempre notificam."><Toggle checked={n.mentionsOnly} onChange={(v) => update({ notifications: { ...n, mentionsOnly: v } })} label="Somente menções" /></SettingRow>
      <SettingRow title="Silenciar notificações durante chamadas" description="Sem pop-ups do sistema enquanto você estiver em voz."><Toggle checked={n.muteInCall} onChange={(v) => update({ notifications: { ...n, muteInCall: v } })} label="Silenciar em chamadas" /></SettingRow>
      <SettingRow title="Piscar título da aba" description="Chama atenção quando chega mensagem e a janela está em segundo plano."><Toggle checked={n.flashTitle} onChange={(v) => update({ notifications: { ...n, flashTitle: v } })} label="Piscar título" /></SettingRow>
      <div className="divider" />
      <h3 className="mt-0">Sons</h3>
      <SettingRow title="Ativar sons"><Toggle checked={s.enabled} onChange={(v) => update({ sounds: { ...s, enabled: v } })} label="Ativar sons" /></SettingRow>
      <SettingRow title="Nova mensagem"><Toggle checked={s.message} disabled={!s.enabled} onChange={(v) => update({ sounds: { ...s, message: v } })} label="Som de mensagem" /></SettingRow>
      <SettingRow title="Menção"><Toggle checked={s.mention} disabled={!s.enabled} onChange={(v) => update({ sounds: { ...s, mention: v } })} label="Som de menção" /></SettingRow>
      <SettingRow title="Entrar/sair de chamada"><Toggle checked={s.call} disabled={!s.enabled} onChange={(v) => update({ sounds: { ...s, call: v } })} label="Som de chamada" /></SettingRow>
      <div className="field mt-2"><label htmlFor="vol">Volume dos sons: {Math.round(s.volume * 100)}%</label>
        <div className="flex items-center gap-3"><input id="vol" className="flex-1" type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => update({ sounds: { ...s, volume: Number(e.target.value) } })} /><button className="btn btn-sm" onClick={() => playSound('mention')}>Testar</button></div></div>
      <div className="divider" />
      <h3 className="mt-0">Servidores e canais silenciados</h3>
      {!muted.length ? <p className="text-fg-muted">Nada silenciado. Clique com o botão direito em um servidor ou canal para ajustar.</p> : muted.map((p) => (
        <div key={p.id} className="flex items-center justify-between border-b border-border py-2">
          <span>{p.server_id ? `Servidor: ${servers?.find((x) => x.id === p.server_id)?.name ?? '—'}` : p.channel_id ? 'Canal' : 'Conversa direta'} — {p.muted ? 'silenciado' : p.level === 'mentions' ? 'só menções' : 'nenhuma notificação'}</span>
          <button className="btn btn-sm" onClick={() => void removePref(p.id)}>Restaurar</button>
        </div>
      ))}
    </div>
  )
}

export function KeybindsTab() {
  const { settings, update } = useSettings()
  const k = settings.keybinds
  const [rec, setRec] = useState<keyof typeof k | null>(null)
  useEffect(() => {
    if (!rec) return
    const down = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRec(null)
      if (rec === 'pushToTalk') {
        update({ keybinds: { ...k, pushToTalk: e.code } })
        setRec(null)
        return
      }
      if (isModifierKey(e)) return
      if (!e.ctrlKey && !e.altKey && !e.metaKey) return toast.info('Use ao menos Ctrl, Alt ou Meta no atalho.')
      update({ keybinds: { ...k, [rec]: comboFromEvent(e) } })
      setRec(null)
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [rec, k, update])
  const rows: [keyof typeof k, string, string][] = [
    ['pushToTalk', 'Push-to-talk', 'Segure para falar (ative em Voz e vídeo). Funciona com a janela em foco.'],
    ['toggleMute', 'Alternar microfone', 'Silencia/ativa o microfone durante a chamada.'],
    ['toggleDeafen', 'Alternar ensurdecer', 'Silencia a saída de áudio e o microfone.'],
    ['quickSwitcher', 'Busca rápida', 'Abre a busca global de servidores, canais e pessoas.'],
  ]
  return (
    <div className="max-w-xl">
      <H>Atalhos de teclado</H>
      {rows.map(([key, title, desc]) => (
        <SettingRow key={key} title={title} description={desc}>
          <button className={clsx('btn min-w-36', rec === key && 'btn-primary')} onClick={() => setRec(rec === key ? null : key)} aria-label={`Alterar atalho de ${title}`}>
            {rec === key ? 'Pressione a tecla…' : key === 'pushToTalk' ? codeLabel(k[key]) : k[key]}
          </button>
        </SettingRow>
      ))}
      <button className="btn btn-ghost mt-2" onClick={() => update({ keybinds: { pushToTalk: 'Backquote', toggleMute: 'Ctrl+Shift+M', toggleDeafen: 'Ctrl+Shift+D', quickSwitcher: 'Ctrl+K' } })}>Restaurar padrões</button>
      <div className="divider" />
      <h3 className="mt-0">Outros atalhos</h3>
      <ul className="m-0 list-none p-0 text-fg-2">
        {[['Enter', 'Enviar mensagem'], ['Shift+Enter', 'Quebra de linha'], ['Esc', 'Fechar modal / cancelar edição/resposta'], ['Alt+↑ / Alt+↓', 'Canal anterior / próximo'], ['Ctrl+Alt+↑ / ↓', 'Servidor anterior / próximo'], ['Ctrl+F', 'Buscar mensagens no canal'], ['↑ / ↓ / Tab / Enter', 'Navegar e escolher no autocompletar de @menções'], ['Ctrl+/', 'Ajuda e atalhos']].map(([a, b]) => (
          <li key={a} className="flex justify-between border-b border-border py-2"><kbd className="rounded bg-tertiary px-2 py-0.5 font-mono text-xs">{a}</kbd><span>{b}</span></li>
        ))}
      </ul>
    </div>
  )
}

export function DesktopTab() {
  const { settings, update } = useSettings()
  const [auto, setAuto] = useState<boolean | null>(null)
  useEffect(() => {
    if (!isTauri) return
    void import('@tauri-apps/plugin-autostart').then((m) => m.isEnabled()).then(setAuto).catch(() => setAuto(false))
  }, [])
  if (!isTauri)
    return (
      <div className="max-w-xl"><H>Aplicativo</H>
        <p className="card text-fg-2">Estas opções (iniciar com o Windows, minimizar para a bandeja) existem apenas no <strong>aplicativo desktop</strong>. Instale o app Windows para usá-las — veja <code>docs/DESKTOP.md</code>.</p></div>
    )
  const d = settings.desktop
  const toggleAuto = async (v: boolean) => {
    try {
      const m = await import('@tauri-apps/plugin-autostart')
      if (v) await m.enable()
      else await m.disable()
      setAuto(v)
      update({ desktop: { ...d, autostart: v } })
    } catch (e) {
      toast.error(errorMessage(e, 'Não foi possível alterar a inicialização com o Windows.'))
    }
  }
  const setTray = async (v: boolean) => {
    update({ desktop: { ...d, closeToTray: v } })
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('set_close_to_tray', { enabled: v })
    } catch {
      toast.error('Não foi possível aplicar a configuração da bandeja.')
    }
  }
  return (
    <div className="max-w-xl"><H>Aplicativo</H>
      <SettingRow title="Versão" description={`Vibe Chat ${APP_VERSION}`}><button className="btn btn-sm" onClick={() => void checkForUpdate(false)}>Procurar atualização</button></SettingRow>
      <SettingRow title="Iniciar junto com o Windows"><Toggle checked={!!auto} disabled={auto === null} onChange={(v) => void toggleAuto(v)} label="Iniciar com o Windows" /></SettingRow>
      <SettingRow title="Minimizar para a bandeja ao fechar" description="O app continua em segundo plano; use o ícone da bandeja para sair de vez."><Toggle checked={d.closeToTray} onChange={(v) => void setTray(v)} label="Minimizar para a bandeja" /></SettingRow>
    </div>
  )
}

/* ---------------------------------------------------------- Diagnóstico */
type Check = { label: string; state: 'run' | 'ok' | 'warn' | 'fail'; detail: string }

export function DiagnosticsTab() {
  const [checks, setChecks] = useState<Check[]>([])
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    const out: Check[] = []
    const push = (c: Check) => {
      out.push(c)
      setChecks([...out])
    }
    push({ label: 'Rede', state: navigator.onLine ? 'ok' : 'fail', detail: navigator.onLine ? 'Navegador online.' : 'Sem conexão.' })
    push({ label: 'Contexto seguro (HTTPS)', state: window.isSecureContext ? 'ok' : 'fail', detail: window.isSecureContext ? 'Câmera, microfone e tela disponíveis.' : 'Sem HTTPS, o navegador bloqueia microfone/câmera/tela (exceto em localhost).' })

    let t = performance.now()
    const r = await supabase.from('servers').select('id', { head: true, count: 'exact' })
    push({ label: 'Banco de dados (Supabase)', state: r.error ? 'fail' : 'ok', detail: r.error ? errorMessage(r.error) : `Resposta em ${Math.round(performance.now() - t)} ms.` })

    const { data: sess } = await supabase.auth.getSession()
    push({ label: 'Sessão', state: sess.session ? 'ok' : 'fail', detail: sess.session ? `Expira em ${Math.max(0, Math.round(((sess.session.expires_at ?? 0) * 1000 - Date.now()) / 60000))} min (renovação automática).` : 'Sem sessão ativa.' })

    t = performance.now()
    const rt = await new Promise<string>((resolve) => {
      const ch = supabase.channel(`diag:${Math.random().toString(36).slice(2)}`)
      const to = setTimeout(() => { void supabase.removeChannel(ch); resolve('timeout') }, 6000)
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          clearTimeout(to)
          void supabase.removeChannel(ch)
          resolve(s)
        }
      })
    })
    push({ label: 'Tempo real (Realtime)', state: rt === 'SUBSCRIBED' ? 'ok' : 'fail', detail: rt === 'SUBSCRIBED' ? `Conectado em ${Math.round(performance.now() - t)} ms.` : `Falha (${rt}). Verifique se o Realtime está habilitado no projeto.` })

    try {
      await fetchVoiceToken('00000000-0000-0000-0000-000000000000')
      push({ label: 'Função de voz (livekit-token)', state: 'warn', detail: 'Respondeu de forma inesperada.' })
    } catch (e) {
      const m = (e as Error).message
      if (/permissão/i.test(m)) push({ label: 'Função de voz (livekit-token)', state: 'ok', detail: 'Publicada e configurada (a negação de teste é o esperado).' })
      else push({ label: 'Função de voz (livekit-token)', state: 'fail', detail: m })
    }

    push({ label: 'WebRTC', state: typeof RTCPeerConnection !== 'undefined' ? 'ok' : 'fail', detail: typeof RTCPeerConnection !== 'undefined' ? 'Suportado.' : 'Navegador sem WebRTC.' })
    push({ label: 'Compartilhamento de tela', state: typeof navigator.mediaDevices?.getDisplayMedia === 'function' ? 'ok' : 'warn', detail: typeof navigator.mediaDevices?.getDisplayMedia === 'function' ? 'API disponível (áudio do sistema depende de navegador/SO).' : 'getDisplayMedia indisponível.' })
    try {
      const devs = await navigator.mediaDevices.enumerateDevices()
      push({ label: 'Dispositivos de mídia', state: 'ok', detail: `${devs.filter((d) => d.kind === 'audioinput').length} microfone(s), ${devs.filter((d) => d.kind === 'audiooutput').length} saída(s), ${devs.filter((d) => d.kind === 'videoinput').length} câmera(s).` })
    } catch {
      push({ label: 'Dispositivos de mídia', state: 'fail', detail: 'Não foi possível listar.' })
    }
    const np = await notificationPermission()
    push({ label: 'Notificações', state: np === 'granted' ? 'ok' : 'warn', detail: np })
    setRunning(false)
  }

  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      void run()
    }
  }, [])

  return (
    <div className="max-w-2xl">
      <H>Diagnóstico de conexão</H>
      <button className="btn btn-primary mb-4" onClick={() => void run()} disabled={running}>{running && <Spinner size={14} />} Executar novamente</button>
      <ul className="m-0 list-none p-0">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-3 border-b border-border py-2.5">
            {c.state === 'ok' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" /> : c.state === 'fail' ? <XCircle size={18} className="mt-0.5 shrink-0 text-danger" /> : c.state === 'warn' ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" /> : <Loader2 size={18} className="spin mt-0.5" />}
            <div><div className="font-semibold">{c.label}</div><div className="text-xs text-fg-2">{c.detail}</div></div>
          </li>
        ))}
      </ul>
      <div className="divider" />
      <h3 className="mt-0">Informações</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-fg-2">
        <dt>Versão</dt><dd>{APP_VERSION}</dd><dt>Compilado em</dt><dd>{BUILD_TIME}</dd>
        <dt>Plataforma</dt><dd>{isTauri ? 'Aplicativo desktop (Tauri)' : 'Navegador'}</dd>
        <dt>Backend</dt><dd>{env.supabaseUrl}</dd><dt>Navegador</dt><dd className="break-all">{navigator.userAgent}</dd>
      </dl>
    </div>
  )
}
