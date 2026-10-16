import type { ReactNode } from 'react'
import { create } from 'zustand'

export interface MenuItem {
  label?: string
  icon?: ReactNode
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  hint?: string
  /** Explica por que o item está desabilitado (tooltip). */
  tip?: string
  /** Tipo do item: padrão, controle deslizante, caixa de seleção ou submenu. */
  kind?: 'slider' | 'checkbox'
  value?: number
  min?: number
  max?: number
  step?: number
  format?: (v: number) => string
  onChange?: (v: number) => void
  checked?: boolean
  onToggle?: (checked: boolean) => void
  children?: MenuItem[]
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

export type MobilePane = 'nav' | 'main' | 'members'

interface UIState {
  modals: { id: number; node: ReactNode }[]
  openModal: (node: ReactNode) => number
  closeModal: (id?: number) => void

  menu: { x: number; y: number; items: MenuItem[] } | null
  openMenu: (x: number, y: number, items: MenuItem[]) => void
  closeMenu: () => void

  toasts: Toast[]
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void

  /** Navegação ativa (usada por notificações/não lidas). */
  activeChannelId: string | null
  activeDmId: string | null
  setActive: (v: { channelId?: string | null; dmId?: string | null }) => void

  mobilePane: MobilePane
  setMobilePane: (p: MobilePane) => void

  quickSwitcherOpen: boolean
  setQuickSwitcher: (v: boolean) => void

  /** Cartão de perfil flutuante. */
  profileCard: { userId: string; serverId: string | null; x: number; y: number } | null
  openProfile: (userId: string, serverId: string | null, x: number, y: number) => void
  closeProfile: () => void

  /** Mensagem a destacar após "ir para a mensagem" (busca / fixadas / menções). */
  jumpTo: string | null
  setJumpTo: (id: string | null) => void
}

let modalSeq = 1
let toastSeq = 1

export const useUI = create<UIState>((set, get) => ({
  modals: [],
  openModal: (node) => {
    const id = modalSeq++
    set({ modals: [...get().modals, { id, node }] })
    return id
  },
  closeModal: (id) =>
    set({ modals: id === undefined ? get().modals.slice(0, -1) : get().modals.filter((m) => m.id !== id) }),

  menu: null,
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),

  toasts: [],
  toast: (text, kind = 'info') => {
    const id = toastSeq++
    set({ toasts: [...get().toasts.slice(-3), { id, kind, text }] })
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  activeChannelId: null,
  activeDmId: null,
  setActive: (v) =>
    set({
      activeChannelId: v.channelId === undefined ? get().activeChannelId : v.channelId,
      activeDmId: v.dmId === undefined ? get().activeDmId : v.dmId,
    }),

  mobilePane: 'nav',
  setMobilePane: (mobilePane) => set({ mobilePane }),

  quickSwitcherOpen: false,
  setQuickSwitcher: (quickSwitcherOpen) => set({ quickSwitcherOpen }),

  profileCard: null,
  openProfile: (userId, serverId, x, y) => set({ profileCard: { userId, serverId, x, y } }),
  closeProfile: () => set({ profileCard: null }),

  jumpTo: null,
  setJumpTo: (jumpTo) => set({ jumpTo }),
}))

export const toast = {
  info: (t: string) => useUI.getState().toast(t, 'info'),
  success: (t: string) => useUI.getState().toast(t, 'success'),
  error: (t: string) => useUI.getState().toast(t, 'error'),
}
