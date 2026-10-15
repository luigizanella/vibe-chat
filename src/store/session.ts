import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { isConfigured } from '@/lib/env'
import type { Profile } from '@/lib/types'
import { useSettings } from './settings'

type Phase = 'loading' | 'signedOut' | 'ready' | 'disabled'

interface SessionState {
  phase: Phase
  session: Session | null
  user: User | null
  profile: Profile | null
  /** true quando o usuário chegou por link de recuperação de senha. */
  recovery: boolean
  init: () => void
  loadProfile: () => Promise<void>
  setProfile: (p: Profile) => void
  signOut: () => Promise<void>
  clearRecovery: () => void
}

let started = false

export const useSession = create<SessionState>((set, get) => ({
  phase: 'loading',
  session: null,
  user: null,
  profile: null,
  recovery: false,
  init: () => {
    if (started) return
    started = true
    if (!isConfigured) {
      set({ phase: 'signedOut' })
      return
    }
    supabase.auth.onAuthStateChange((event, session) => {
      // Não faça chamadas ao Supabase diretamente dentro deste callback (risco de deadlock): use setTimeout.
      const prevUser = get().user?.id
      set({ session, user: session?.user ?? null, recovery: event === 'PASSWORD_RECOVERY' ? true : get().recovery })
      if (!session) {
        useSettings.getState().bindUser(null)
        set({ phase: 'signedOut', profile: null })
        return
      }
      if (session.user.id !== prevUser || event === 'USER_UPDATED') setTimeout(() => void get().loadProfile(), 0)
    })
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) set({ phase: 'signedOut' })
    })
  },
  loadProfile: async () => {
    const user = get().user
    if (!user) return
    // o perfil é criado por trigger; pequena espera caso a replicação demore
    let profile: Profile | null = null
    for (let i = 0; i < 4 && !profile; i++) {
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      profile = data as Profile | null
      if (!profile) await new Promise((r) => setTimeout(r, 400))
    }
    if (!profile) {
      set({ phase: 'signedOut' })
      return
    }
    useSettings.getState().bindUser(user.id)
    void useSettings.getState().hydrateRemote(user.id)
    set({ profile, phase: profile.disabled_at ? 'disabled' : 'ready' })
  },
  setProfile: (profile) => set({ profile }),
  signOut: async () => {
    await supabase.auth.signOut()
    set({ phase: 'signedOut', profile: null, session: null, user: null })
  },
  clearRecovery: () => set({ recovery: false }),
}))
