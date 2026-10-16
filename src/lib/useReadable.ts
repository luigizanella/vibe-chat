import { useCallback } from 'react'
import { useSettings } from '@/store/settings'
import { readableColor } from './color'

const SURFACES = {
  dark: { primary: '#000000', secondary: '#0a0a0a', tertiary: '#111111' },
  graphite: { primary: '#313338', secondary: '#2b2d31', tertiary: '#232428' },
  light: { primary: '#ffffff', secondary: '#f8f8f9', tertiary: '#f1f1f2' },
}

/** Retorna uma função que ajusta cores de cargo para ficarem legíveis no tema atual. */
export function useReadable(surface: 'primary' | 'secondary' | 'tertiary' = 'primary') {
  const theme = useSettings((s) => s.settings.theme)
  const key = theme === 'system' ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
  const bg = SURFACES[key][surface]
  return useCallback((color: string | undefined) => (color ? readableColor(color, bg) : undefined), [bg])
}
