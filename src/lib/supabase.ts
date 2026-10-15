import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, isConfigured } from './env'

/**
 * Cliente único do Supabase. Apenas a chave anon/publishable entra no bundle;
 * o acesso real é protegido por RLS e funções RPC no banco.
 * Sessão persistida em localStorage com renovação automática do token.
 */
export const supabase: SupabaseClient = createClient(
  isConfigured ? env.supabaseUrl : 'http://127.0.0.1:54321',
  isConfigured ? env.supabaseAnonKey : 'not-configured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'vibe.auth',
    },
    realtime: { params: { eventsPerSecond: 20 } },
  },
)

export interface RpcError extends Error {
  code?: string
}

/** Chama uma RPC e lança erro tipado em caso de falha. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

/** Lê dados e lança em caso de erro. */
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw res.error
  return res.data as T
}
