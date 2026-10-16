import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { contrastColor } from '@/lib/color'
import type { NoiseMode } from '@/lib/micProcessor'

export interface VoiceSettings {
  inputId: string // dispositivos são locais da máquina: não sincronizam
  outputId: string
  cameraId: string
  pttEnabled: boolean
  autoSensitivity: boolean
  sensitivity: number // 0–100: nível abaixo do qual o microfone é silenciado
  /** Supressão de ruído: nenhuma, do navegador ou RNNoise (padrão, roda localmente). */
  noiseMode: NoiseMode
  echoCancellation: boolean
  autoGainControl: boolean
  cameraQuality: '360p' | '720p' | '1080p'
  screenQuality: '720p' | '1080p'
  screenFps: 30 | 60
  screenAudio: boolean
  joinMuted: boolean
}

export interface Settings {
  theme: 'dark' | 'light' | 'system'
  accent: string
  scale: number
  language: 'pt-BR'
  compact: boolean
  showMembers: boolean
  sounds: { enabled: boolean; volume: number; message: boolean; mention: boolean; call: boolean; voiceState: boolean; stream: boolean }
  notifications: { desktop: boolean; mentionsOnly: boolean; muteInCall: boolean; flashTitle: boolean }
  keybinds: { pushToTalk: string; toggleMute: string; toggleDeafen: string; quickSwitcher: string }
  voice: VoiceSettings
  desktop: { autostart: boolean; closeToTray: boolean }
  /** Apelidos locais que VOCÊ dá às outras pessoas (só você vê). */
  nicknames: Record<string, string>
  /** Volume do bot de música (0–100), só para você. */
  musicVolume: number
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#6b5bff',
  scale: 1,
  language: 'pt-BR',
  compact: false,
  showMembers: true,
  sounds: { enabled: true, volume: 0.5, message: true, mention: true, call: true, voiceState: true, stream: true },
  notifications: { desktop: true, mentionsOnly: false, muteInCall: false, flashTitle: true },
  keybinds: { pushToTalk: 'Backquote', toggleMute: 'Ctrl+Shift+M', toggleDeafen: 'Ctrl+Shift+D', quickSwitcher: 'Ctrl+K' },
  voice: {
    inputId: 'default',
    outputId: 'default',
    cameraId: '',
    pttEnabled: false,
    autoSensitivity: true,
    sensitivity: 35,
    noiseMode: 'high',
    echoCancellation: true,
    autoGainControl: true,
    cameraQuality: '720p',
    screenQuality: '1080p',
    screenFps: 30,
    screenAudio: true,
    joinMuted: false,
  },
  desktop: { autostart: false, closeToTray: true },
  nicknames: {},
  musicVolume: 60,
}

const LS_KEY = 'vibe.settings.v1'

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  // mapas livres (ex.: apelidos): base vazia aceita todas as chaves do patch
  if (base && typeof base === 'object' && !Array.isArray(base) && Object.keys(base as object).length === 0) return patch as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in out)) continue
    const cur = out[k]
    out[k] = cur && typeof cur === 'object' && !Array.isArray(cur) ? deepMerge(cur, v) : typeof v === typeof cur ? v : cur
  }
  return out as T
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? deepMerge(DEFAULT_SETTINGS, JSON.parse(raw)) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return [250, 100, 69]
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }
  return [h, Math.round(s * 100), Math.round(l * 100)]
}

export function applySettings(s: Settings): void {
  const root = document.documentElement
  const dark = s.theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : s.theme === 'dark'
  root.dataset.theme = dark ? 'dark' : 'light'
  const [h, sat, l] = hexToHsl(s.accent)
  root.style.setProperty('--accent-h', String(h))
  root.style.setProperty('--accent-s', `${sat}%`)
  root.style.setProperty('--accent-l', `${l}%`)
  root.style.setProperty('--accent-contrast', contrastColor(s.accent))
  root.style.setProperty('--ui-scale', String(s.scale))
  root.dataset.compact = String(s.compact)
}

/** Chaves sincronizadas com o banco (user_prefs.settings). Dispositivos ficam só locais. */
function syncable(s: Settings) {
  const { voice, ...rest } = s
  const { inputId: _i, outputId: _o, cameraId: _c, ...voiceSync } = voice
  return { ...rest, voice: voiceSync }
}

interface SettingsState {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  updateVoice: (patch: Partial<VoiceSettings>) => void
  hydrateRemote: (userId: string) => Promise<void>
  bindUser: (userId: string | null) => void
}

let timer: ReturnType<typeof setTimeout> | undefined
let currentUser: string | null = null

function scheduleRemoteSave(s: Settings) {
  if (!currentUser) return
  const uid = currentUser
  clearTimeout(timer)
  timer = setTimeout(() => {
    void supabase
      .from('user_prefs')
      .update({ settings: syncable(s), updated_at: new Date().toISOString() })
      .eq('user_id', uid)
  }, 1200)
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: load(),
  update: (patch) => {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    localStorage.setItem(LS_KEY, JSON.stringify(next))
    applySettings(next)
    scheduleRemoteSave(next)
  },
  updateVoice: (patch) => get().update({ voice: { ...get().settings.voice, ...patch } }),
  hydrateRemote: async (userId) => {
    const { data } = await supabase.from('user_prefs').select('settings').eq('user_id', userId).maybeSingle()
    const remote = data?.settings as Record<string, unknown> | undefined
    if (remote && Object.keys(remote).length) {
      const local = get().settings
      const merged = deepMerge(local, remote)
      merged.voice = { ...merged.voice, inputId: local.voice.inputId, outputId: local.voice.outputId, cameraId: local.voice.cameraId }
      set({ settings: merged })
      localStorage.setItem(LS_KEY, JSON.stringify(merged))
      applySettings(merged)
    }
  },
  bindUser: (userId) => {
    currentUser = userId
  },
}))

applySettings(useSettings.getState().settings)
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const s = useSettings.getState().settings
    if (s.theme === 'system') applySettings(s)
  })
}
