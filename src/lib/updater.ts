import { create } from 'zustand'
import { isTauri } from './env'
import { APP_VERSION, BUILD_TIME } from './types'
import { toast } from '@/store/ui'
import { useVoice } from '@/store/voice'

const CHECK_EVERY_MS = 30 * 60_000 // desktop: a cada 30 min
const WEB_CHECK_EVERY_MS = 5 * 60_000 // web: a cada 5 min (arquivo minúsculo)

interface UpdateState {
  /** 'ready': baixada/detectada e aguardando o fim da chamada (ou um clique em "Reiniciar agora"). */
  status: 'idle' | 'ready'
  version: string | null
  kind: 'desktop' | 'web' | null
  applyNow: () => void
}
export const useUpdate = create<UpdateState>(() => ({ status: 'idle', version: null, kind: null, applyNow: () => undefined }))

const inCall = () => useVoice.getState().status !== 'idle'

/* -------------------------------------------------------------- desktop */
type PendingUpdate = { version: string; install: () => Promise<void> }
let pending: PendingUpdate | null = null
let installing = false

async function installDesktop() {
  if (!pending || installing) return
  installing = true
  try {
    await pending.install() // no Windows o instalador fecha e reabre o app sozinho
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (e) {
    installing = false
    toast.error(`Não foi possível aplicar a atualização: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Procura, baixa em segundo plano e instala quando não há chamada. A sessão fica salva e o app volta logado. */
export async function checkForUpdate(silent = true): Promise<void> {
  if (!isTauri) return void (await checkWebUpdate(silent))
  try {
    if (pending) {
      if (!inCall()) await installDesktop()
      return
    }
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) {
      if (!silent) toast.info('Você já está na versão mais recente.')
      return
    }
    await update.download()
    pending = { version: update.version, install: () => update.install() }
    useUpdate.setState({ status: 'ready', version: update.version, kind: 'desktop', applyNow: () => void installDesktop() })
    if (!inCall()) await installDesktop()
    else toast.info(`Atualização ${update.version} pronta. Ela será instalada quando você sair da chamada.`)
  } catch (e) {
    if (!silent) toast.error(`Não foi possível atualizar: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/* ------------------------------------------------------------------ web */
let webNewVersion: string | null = null

async function checkWebUpdate(silent: boolean) {
  if (import.meta.env.DEV) return void (!silent && toast.info('Atualização automática só existe no app publicado.'))
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return
    const v = (await res.json()) as { version?: string; build?: string }
    if (!v.build || v.build === BUILD_TIME) {
      if (!silent) toast.info('Você já está na versão mais recente.')
      return
    }
    webNewVersion = v.version ?? null
    useUpdate.setState({ status: 'ready', version: webNewVersion, kind: 'web', applyNow: () => window.location.reload() })
    if (!inCall()) window.location.reload() // sessão fica no localStorage: volta logado
  } catch {
    /* sem rede: tenta de novo no próximo ciclo */
  }
}

let started = false
/** Liga a verificação periódica. Chame uma vez no AppShell. */
export function startAutoUpdate() {
  if (started) return
  started = true
  void checkForUpdate(true)
  const every = isTauri ? CHECK_EVERY_MS : WEB_CHECK_EVERY_MS
  setInterval(() => void checkForUpdate(true), every)
  if (!isTauri) document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void checkForUpdate(true))
  // ao sair da chamada, aplica o que ficou esperando
  useVoice.subscribe((s, prev) => {
    if (prev.status !== 'idle' && s.status === 'idle' && useUpdate.getState().status === 'ready') useUpdate.getState().applyNow()
  })
  void APP_VERSION
}
