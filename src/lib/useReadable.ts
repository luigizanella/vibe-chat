import { useCallback } from 'react'
import { useSettings } from '@/store/settings'
import { readableColor } from './color'

const SURFACES = {
  dark: { primary: '#313338', secondary: '#2b2d31', tertiary: '#232428' },
  light: { primary: '#ffffff', secondary: '#f2f3f5', tertiary: '#e3e5e8' },
}

/** Retorna uma função que ajusta cores de cargo para ficarem legíveis no tema atual. */
export function useReadable(surface: 'primary' | 'secondary' | 'tertiary' = 'primary') {
  const theme = useSettings((s) => s.settings.theme)
  const dark = theme === 'system' ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) : theme === 'dark'
  const bg = SURFACES[dark ? 'dark' : 'light'][surface]
  return useCallback((color: string | undefined) => (color ? readableColor(color, bg) : undefined), [bg])
}
