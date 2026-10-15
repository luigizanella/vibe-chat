import { isTauri } from './env'
import { toast } from '@/store/ui'

/** Verifica atualizações do app desktop (no navegador não faz nada). */
export async function checkForUpdate(silent = true): Promise<void> {
  if (!isTauri) return
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) {
      if (!silent) toast.info('Você já está na versão mais recente.')
      return
    }
    toast.info(`Nova versão ${update.version} encontrada. Baixando…`)
    await update.downloadAndInstall()
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (e) {
    if (!silent) toast.error(`Não foi possível atualizar: ${e instanceof Error ? e.message : String(e)}`)
  }
}
