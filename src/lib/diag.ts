/** Diagnóstico de voz/mídia: registro curto de eventos (para o relatório) e detecção de navegador/SO. */
interface Entry { t: number; msg: string }
const buf: Entry[] = []
const MAX = 80

export const diag = {
  lastDisconnect: null as string | null,
  lastError: null as string | null,
  screenError: null as string | null,
}

/** Registra um evento da chamada (console com prefixo [voz] + relatório). */
export function vozLog(msg: string, data?: unknown) {
  console.info('[voz]', msg, data ?? '')
  buf.push({ t: Date.now(), msg: data === undefined ? msg : `${msg} ${typeof data === 'string' ? data : JSON.stringify(data)}` })
  if (buf.length > MAX) buf.shift()
}

export const getVozLog = () => buf.slice()

export function isSafari(): boolean {
  const ua = navigator.userAgent
  return /safari/i.test(ua) && !/chrome|chromium|crios|android|edg|fxios/i.test(ua)
}
export function isMac(): boolean {
  return /Mac/i.test(navigator.platform || navigator.userAgent) && !/iPhone|iPad/i.test(navigator.userAgent)
}
export function isMobile(): boolean {
  return /iPhone|iPad|Android/i.test(navigator.userAgent)
}

export function browserInfo(): { browser: string; os: string } {
  const ua = navigator.userAgent
  const browser = /edg\//i.test(ua) ? 'Edge' : /firefox|fxios/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : isSafari() ? 'Safari' : 'Outro'
  const v = /(?:Version|Chrome|Edg|Firefox|CriOS|FxiOS)\/([\d.]+)/i.exec(ua)?.[1] ?? ''
  const os = /Windows/i.test(ua) ? 'Windows' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Mac/i.test(ua) ? 'macOS' : /Android/i.test(ua) ? 'Android' : /Linux/i.test(ua) ? 'Linux' : 'Outro'
  return { browser: `${browser} ${v}`.trim(), os }
}
