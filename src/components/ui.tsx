import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode,
} from 'react'
import clsx from 'clsx'
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Info, Loader2, X } from 'lucide-react'
import { useUI, type MenuItem } from '@/store/ui'
import { Layer } from './Layer'
import { colorFromId, initials } from '@/lib/format'
import { mediaUrl } from '@/lib/media'
import type { Presence } from '@/lib/types'
import { errorMessage } from '@/lib/errors'

/* ----------------------------------------------------------------- Spinner */
export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={clsx('spin', className)} aria-label="Carregando" role="status" />
}

export function CenterSpinner({ label }: { label?: string }) {
  return (
    <div className="grid h-full place-items-center p-8 text-fg-muted">
      <div className="flex flex-col items-center gap-3">
        <Spinner size={28} />
        {label && <span>{label}</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Avatar */
const PRESENCE_COLOR: Record<Presence, string> = {
  online: 'var(--presence-online)',
  idle: 'var(--presence-idle)',
  dnd: 'var(--presence-dnd)',
  offline: 'var(--presence-offline)',
}
export const PRESENCE_LABEL: Record<Presence, string> = {
  online: 'Online',
  idle: 'Ausente',
  dnd: 'Não perturbe',
  offline: 'Offline',
}

export function PresenceDot({ status, size = 10, ring = 'var(--bg-secondary)' }: { status: Presence; size?: number; ring?: string }) {
  return (
    <span
      aria-label={PRESENCE_LABEL[status]}
      style={{ width: size, height: size, background: PRESENCE_COLOR[status], boxShadow: `0 0 0 3px ${ring}` }}
      className="absolute -right-0.5 -bottom-0.5 rounded-full"
    >
      {status === 'dnd' && <span className="absolute top-1/2 left-1/2 h-[2px] w-[60%] -translate-x-1/2 -translate-y-1/2 rounded bg-[var(--bg-secondary)]" />}
    </span>
  )
}

export function Avatar({
  path, name, id, size = 32, status, ring, square, className, speaking,
}: {
  path?: string | null
  name: string
  id: string
  size?: number
  status?: Presence
  ring?: string
  square?: boolean
  className?: string
  /** Anel verde fino ao redor do avatar enquanto a pessoa fala. */
  speaking?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const url = failed ? null : mediaUrl(path)
  return (
    <span
      className={clsx('relative inline-grid shrink-0 place-items-center overflow-visible select-none', className)}
      style={{ width: size, height: size }}
    >
      <span
        className="grid h-full w-full place-items-center overflow-hidden text-white" /* iniciais sobre cor sólida gerada */
        style={{ background: url ? 'var(--bg-tertiary)' : colorFromId(id), borderRadius: square ? 'var(--radius-lg)' : '50%', fontSize: size * 0.38, fontWeight: 700 }}
      >
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" draggable={false} onError={() => setFailed(true)} loading="lazy" />
        ) : (
          initials(name)
        )}
      </span>
      {speaking && (
        <span aria-hidden className="pointer-events-none absolute border-2 border-[var(--success)]" style={{ inset: -4, borderRadius: square ? 'var(--radius-lg)' : '50%' }} />
      )}
      {status && <PresenceDot status={status} size={Math.max(8, size * 0.32)} ring={ring} />}
    </span>
  )
}

/* ------------------------------------------------------------------- Modal */
const ModalCtx = createContext<() => void>(() => undefined)
export const useCloseModal = () => useContext(ModalCtx)

export function ModalHost() {
  const modals = useUI((s) => s.modals)
  const close = useUI((s) => s.closeModal)
  return (
    <>
      {modals.map((m) => (
        <ModalCtx.Provider key={m.id} value={() => close(m.id)}>
          {m.node}
        </ModalCtx.Provider>
      ))}
    </>
  )
}

export function Modal({
  title, children, footer, size = 'md', description, hideClose,
}: {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
  hideClose?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const close = useCloseModal()
  useLayoutEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  const titleId = useRef(`m-${Math.random().toString(36).slice(2)}`).current
  return (
    <dialog
      ref={ref}
      className="modal"
      data-size={size}
      aria-labelledby={titleId}
      onClose={close}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) close()
      }}
    >
      <div className="flex max-h-[90vh] flex-col bg-primary text-fg">
        <header className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <h2 id={titleId} className="m-0 text-xl font-bold">{title}</h2>
            {description && <p className="mt-1 mb-0 text-fg-2">{description}</p>}
          </div>
          {!hideClose && (
            <button className="icon-btn -mt-1 -mr-2" onClick={close} aria-label="Fechar" data-tip="Fechar (Esc)">
              <X size={18} />
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-border bg-secondary px-5 py-3">{footer}</footer>}
      </div>
    </dialog>
  )
}

export function ConfirmModal({
  title, message, confirmLabel = 'Confirmar', danger, onConfirm, requireText,
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  requireText?: string
  onConfirm: () => Promise<void> | void
}) {
  const close = useCloseModal()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const run = async () => {
    setBusy(true)
    setErr(null)
    try {
      await onConfirm()
      close()
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal
      title={title}
      footer={
        <>
          <button className="btn btn-ghost" onClick={close} disabled={busy}>Cancelar</button>
          <button className={clsx('btn', danger ? 'btn-danger' : 'btn-primary')} onClick={run} disabled={busy || (requireText !== undefined && typed !== requireText)} autoFocus={!requireText}>
            {busy && <Spinner size={14} />} {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-fg-2">{message}</div>
      {requireText !== undefined && (
        <div className="field mt-4">
          <label htmlFor="confirm-text">Digite “{requireText}” para confirmar</label>
          <input id="confirm-text" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
        </div>
      )}
      {err && <p className="error-text mt-3" role="alert">{err}</p>}
    </Modal>
  )
}

export function confirmAction(props: Parameters<typeof ConfirmModal>[0]) {
  useUI.getState().openModal(<ConfirmModal {...props} />)
}

/* ----------------------------------------------------------- Context menus */
export function ContextMenuHost() {
  const menu = useUI((s) => s.menu)
  const close = useUI((s) => s.closeMenu)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const t = setTimeout(() => ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(), 30)
    window.addEventListener('scroll', close, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu, close])

  if (!menu) return null
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const container = (e.target as HTMLElement).closest('[role="menu"]')
    if (!container) return
    e.preventDefault()
    const items = [...container.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
  return (
    <Layer anchor={{ x: menu.x, y: menu.y }} placement="bottom-start" gap={2} onDismiss={close} closeOnScroll onKeyDown={onKey}>
      <div ref={ref} className="menu" role="menu">
        <MenuList items={menu.items} onClose={close} />
      </div>
    </Layer>
  )
}
function MenuRow({ it, onClose }: { it: MenuItem; onClose: () => void }) {
  const [open, setOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const enter = () => {
    clearTimeout(timer.current)
    if (!it.disabled) setOpen(true)
  }
  const leave = () => {
    timer.current = setTimeout(() => setOpen(false), 160)
  }
  const [val, setVal] = useState(it.value ?? 0)
  const [checked, setChecked] = useState(!!it.checked)
  if (it.separator) return <div className="menu-sep" role="separator" />

  if (it.kind === 'slider') {
    const fmt = it.format ?? ((v: number) => `${Math.round(v * 100)}%`)
    return (
      <div className="px-2 py-1.5" role="group" aria-label={it.label}>
        <div className="mb-1 flex items-center justify-between text-sm text-fg-2">
          <span>{it.label}</span>
          <span className="text-xs tabular-nums">{fmt(val)}</span>
        </div>
        <input
          type="range"
          className="w-full"
          min={it.min ?? 0}
          max={it.max ?? 1}
          step={it.step ?? 0.01}
          value={val}
          aria-label={it.label}
          disabled={it.disabled}
          onChange={(e) => {
            const v = Number(e.target.value)
            setVal(v)
            it.onChange?.(v)
          }}
        />
      </div>
    )
  }

  if (it.kind === 'checkbox') {
    return (
      <button
        role="menuitemcheckbox"
        aria-checked={checked}
        className={clsx('menu-item', it.danger && 'danger')}
        disabled={it.disabled}
        data-tip={it.disabled ? it.tip : undefined}
        data-tip-side="right"
        onClick={() => {
          setChecked(!checked)
          it.onToggle?.(!checked)
        }}
      >
        <span className="flex items-center gap-2">{it.icon}{it.label}</span>
        <span className={clsx('grid h-4 w-4 place-items-center rounded-sm border', checked ? 'border-current bg-current' : 'border-current')} aria-hidden>
          {checked && <Check size={12} className="text-[var(--bg-tertiary)]" />}
        </span>
      </button>
    )
  }

  if (it.children) {
    return (
      <div ref={rowRef} onMouseEnter={enter} onMouseLeave={leave}>
        <button
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open}
          className="menu-item"
          disabled={it.disabled}
          data-tip={it.disabled ? it.tip : undefined}
          data-tip-side="right"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => e.key === 'ArrowRight' && setOpen(true)}
        >
          <span className="flex items-center gap-2">{it.icon}{it.label}</span>
          <ChevronRight size={14} aria-hidden />
        </button>
        {open && rowRef.current && (
          <Layer
            anchor={rowRef.current}
            placement="right-start"
            gap={2}
            align={-6}
            dismissOutside={false}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                setOpen(false)
                rowRef.current?.querySelector('button')?.focus()
              }
            }}
          >
            <div className="menu" role="menu" onMouseEnter={enter} onMouseLeave={leave}>
              <MenuList items={it.children} onClose={onClose} />
            </div>
          </Layer>
        )}
      </div>
    )
  }
  return (
    <button
      role="menuitem"
      className={clsx('menu-item', it.danger && 'danger')}
      disabled={it.disabled}
      data-tip={it.disabled ? it.tip : undefined}
      data-tip-side="right"
      onClick={() => {
        onClose()
        it.onClick?.()
      }}
    >
      <span className="flex items-center gap-2">{it.icon}{it.label}</span>
      {it.hint && <span className="text-xs opacity-70">{it.hint}</span>}
    </button>
  )
}

function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <>
      {items.map((it, i) => (
        <MenuRow key={i} it={it} onClose={onClose} />
      ))}
    </>
  )
}
export function useContextMenu(build: () => MenuItem[]) {
  const open = useUI((s) => s.openMenu)
  return useCallback(
    (e: React.MouseEvent) => {
      const items = build().filter((i) => i.separator || i.label)
      if (!items.length) return
      e.preventDefault()
      e.stopPropagation()
      open(e.clientX, e.clientY, items)
    },
    [build, open],
  )
}

/* ---------------------------------------------------------------- Tooltips */
export function TooltipHost() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const hide = () => {
      clearTimeout(timer)
      ref.current?.setAttribute('data-show', 'false')
    }
    const show = (el: HTMLElement) => {
      const tip = el.getAttribute('data-tip')
      const host = ref.current
      if (!tip || !host) return
      host.textContent = tip
      const r = el.getBoundingClientRect()
      const side = el.getAttribute('data-tip-side') ?? 'top'
      host.style.left = '0px'
      host.style.top = '0px'
      const t = host.getBoundingClientRect()
      let x = r.left + r.width / 2 - t.width / 2
      let y = r.top - t.height - 8
      if (side === 'right') {
        x = r.right + 10
        y = r.top + r.height / 2 - t.height / 2
      } else if (side === 'bottom') y = r.bottom + 8
      else if (side === 'left') {
        x = r.left - t.width - 10
        y = r.top + r.height / 2 - t.height / 2
      }
      host.style.left = `${Math.max(6, Math.min(x, window.innerWidth - t.width - 6))}px`
      host.style.top = `${Math.max(6, Math.min(y, window.innerHeight - t.height - 6))}px`
      host.setAttribute('data-show', 'true')
    }
    const over = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-tip]')
      if (!el) return hide()
      clearTimeout(timer)
      timer = setTimeout(() => show(el), e.type === 'focusin' ? 0 : 350)
    }
    const out = () => hide()
    document.addEventListener('mouseover', over)
    document.addEventListener('focusin', over)
    document.addEventListener('mouseout', out)
    document.addEventListener('focusout', out)
    document.addEventListener('mousedown', out)
    window.addEventListener('scroll', out, true)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('focusin', over)
      document.removeEventListener('mouseout', out)
      document.removeEventListener('focusout', out)
      document.removeEventListener('mousedown', out)
      window.removeEventListener('scroll', out, true)
    }
  }, [])
  return <div id="tooltip-host" ref={ref} popover="manual" role="tooltip" data-show="false" />
}

/* ------------------------------------------------------------------ Toasts */
export function ToastHost() {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try {
      hostRef.current?.showPopover?.()
    } catch {
      /* sem suporte */
    }
  }, [])
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismissToast)
  return (
    <div id="toast-host" ref={hostRef} popover="manual" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-border bg-[var(--bg-elevated)] px-4 py-3 shadow-[var(--shadow)]"
          style={{ animation: 'slide-up var(--dur) var(--ease)', borderLeft: `4px solid ${t.kind === 'error' ? 'var(--danger)' : t.kind === 'success' ? 'var(--success)' : 'var(--accent)'}` }}
        >
          {t.kind === 'error' ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" /> : t.kind === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" /> : <Info size={18} className="mt-0.5 shrink-0 text-accent" />}
          <span className="flex-1 text-sm">{t.text}</span>
          <button className="icon-btn -m-1 h-6 w-6" onClick={() => dismiss(t.id)} aria-label="Dispensar"><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------- Pequenos */
export function Toggle({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-6 w-10 shrink-0 rounded-full border-0 transition-colors disabled:opacity-50"
      style={{ background: checked ? 'var(--success)' : 'var(--bg-selected)' }}
    >
      <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: checked ? 'translateX(16px)' : 'none' }} />
    </button>
  )
}

export function SettingRow({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        {description && <div className="text-xs text-fg-muted">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && <div className="mb-1 text-fg-muted">{icon}</div>}
      <div className="text-lg font-bold">{title}</div>
      {children && <div className="text-fg-2">{children}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-10 text-center" role="alert">
      <AlertTriangle className="text-danger" />
      <div>{errorMessage(error)}</div>
      {onRetry && <button className="btn" onClick={onRetry}>Tentar novamente</button>}
    </div>
  )
}

export function IconButton({ label, tip, children, className, side, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tip?: string; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <button className={clsx('icon-btn', className)} aria-label={label} data-tip={tip ?? label} data-tip-side={side} {...rest}>
      {children}
    </button>
  )
}

/** Executa uma ação assíncrona exibindo erro em toast. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, opts?: { onError?: (e: unknown) => void }): Promise<T | undefined> => {
    setBusy(true)
    try {
      return await fn()
    } catch (e) {
      if (opts?.onError) opts.onError(e)
      else useUI.getState().toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, run }
}
