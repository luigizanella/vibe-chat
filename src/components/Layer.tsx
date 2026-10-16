import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom'

export type Anchor = HTMLElement | DOMRect | { x: number; y: number }

function isElement(a: Anchor): a is HTMLElement {
  return typeof HTMLElement !== 'undefined' && a instanceof HTMLElement
}
function rectOf(a: Anchor): DOMRect {
  if (isElement(a)) return a.getBoundingClientRect()
  if ('width' in a) return a
  return new DOMRect(a.x, a.y, 0, 0)
}

const FALLBACKS: Record<string, Placement[]> = {
  'bottom-start': ['top-start', 'bottom-end', 'top-end'],
  'bottom-end': ['top-end', 'bottom-start', 'top-start'],
  'top-start': ['bottom-start', 'top-end', 'bottom-end'],
  'top-end': ['bottom-end', 'top-start', 'bottom-start'],
  'right-start': ['left-start', 'right-end', 'left-end'],
  'left-start': ['right-start', 'left-end', 'right-end'],
}

interface LayerProps {
  anchor: Anchor
  placement?: Placement
  /** Distância (px) entre a âncora e a camada. */
  gap?: number
  /** Deslocamento ao longo da borda (ex.: alinhar o primeiro item de um submenu). */
  align?: number
  onDismiss?: () => void
  /** Fecha ao clicar fora de TODAS as camadas (padrão). Submenus deixam o pai decidir. */
  dismissOutside?: boolean
  closeOnScroll?: boolean
  className?: string
  style?: CSSProperties
  role?: string
  label?: string
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}

/**
 * Camada flutuante ÚNICA do app (menus, submenus, popovers, cartões):
 *  - renderizada em portal e promovida à "top layer" do navegador (Popover API), logo
 *    aparece acima de modais (<dialog>), sem depender de z-index;
 *  - posicionada com @floating-ui (vira para o outro lado e se desloca quando falta espaço na tela);
 *  - fecha com Esc (só a camada de cima) e clique fora.
 */
export function Layer({ anchor, placement = 'bottom-start', gap = 4, align = 0, onDismiss, dismissOutside = true, closeOnScroll = false, className, style, role, label, onKeyDown, children }: LayerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; placement: Placement } | null>(null)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    try {
      el.showPopover?.()
    } catch {
      /* sem suporte: fica position:fixed normal */
    }
    const virtual = { getBoundingClientRect: () => rectOf(anchor), contextElement: isElement(anchor) ? anchor : undefined }
    const update = () =>
      void computePosition(virtual, el, {
        strategy: 'fixed',
        placement,
        middleware: [offset({ mainAxis: gap, crossAxis: align }), flip({ padding: 8, fallbackPlacements: FALLBACKS[placement] }), shift({ padding: 8 })],
      }).then((p) => setPos({ x: Math.round(p.x), y: Math.round(p.y), placement: p.placement }))
    const cleanup = isElement(anchor) ? autoUpdate(anchor, el, update) : (update(), () => undefined)
    return () => {
      cleanup()
      try {
        el.hidePopover?.()
      } catch {
        /* já oculto */
      }
    }
  }, [anchor, placement, gap, align])

  useLayoutEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!dismissOutside) return
      if (!(e.target as Element | null)?.closest?.('[data-layer]')) dismiss.current?.()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const layers = document.querySelectorAll('[data-layer]')
      if (layers[layers.length - 1] === ref.current) {
        e.stopPropagation()
        dismiss.current?.()
      }
    }
    const onAway = () => dismiss.current?.()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    if (closeOnScroll) {
      window.addEventListener('resize', onAway)
      window.addEventListener('blur', onAway)
    }
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onAway)
      window.removeEventListener('blur', onAway)
    }
  }, [dismissOutside, closeOnScroll])

  return createPortal(
    <div
      ref={ref}
      popover="manual"
      data-layer=""
      data-placement={pos?.placement}
      role={role}
      aria-label={label}
      className={`layer ${className ?? ''}`}
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden', ...style }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  )
}
