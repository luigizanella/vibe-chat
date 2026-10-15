/** Utilitários de atalhos de teclado. */

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'])

export function isModifierKey(e: KeyboardEvent): boolean {
  return MODIFIER_CODES.has(e.code)
}

/** "Ctrl+Shift+M" a partir do evento (para atalhos com modificadores). */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key
  parts.push(k === ' ' ? 'Space' : k)
  return parts.join('+')
}

export function matchCombo(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false
  return comboFromEvent(e) === combo
}

/** Nome amigável de um `KeyboardEvent.code` (push-to-talk usa code, para ser independente de layout). */
export function codeLabel(code: string): string {
  const map: Record<string, string> = {
    Backquote: '` (acento grave)', Space: 'Espaço', Backslash: '\\', Tab: 'Tab', CapsLock: 'Caps Lock',
    ControlLeft: 'Ctrl esquerdo', ControlRight: 'Ctrl direito', ShiftLeft: 'Shift esquerdo', ShiftRight: 'Shift direito',
    AltLeft: 'Alt esquerdo', AltRight: 'Alt direito', Enter: 'Enter', Backspace: 'Backspace',
  }
  if (map[code]) return map[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  return code
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}
