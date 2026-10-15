const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

export const env = {
  supabaseUrl: url ?? '',
  supabaseAnonKey: anon ?? '',
  publicAppUrl: ((import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim() || '').replace(/\/$/, ''),
}

export const isConfigured = Boolean(url && anon && /^https?:\/\//.test(url))

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Origem usada em links de convite e redirecionamentos de e-mail. */
export function appOrigin(): string {
  if (env.publicAppUrl) return env.publicAppUrl
  if (isTauri) return 'http://localhost:5173' // dentro do Tauri não há origem https pública
  return window.location.origin
}
