import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Play, Video, VideoOff } from 'lucide-react'
import { useSettings } from '@/store/settings'
import { diagnoseMic, useVoice } from '@/store/voice'
import { isTauri } from '@/lib/env'
import { MicChain, captureConstraints, type NoiseMode } from '@/lib/micProcessor'
import { queryMediaPermissions, reportMediaError, permissionSteps } from '@/lib/mediaErrors'
import { codeLabel } from '@/lib/keys'
import { SettingRow, Toggle } from '@/components/ui'
import { toast } from '@/store/ui'

const H = ({ children }: { children: React.ReactNode }) => <h2 className="mt-0 mb-5 text-xl font-bold">{children}</h2>

function useDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [labelsHidden, setLabelsHidden] = useState(false)
  const refresh = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list)
      setLabelsHidden(list.some((d) => !d.label))
    } catch {
      setDevices([])
    }
  }, [])
  useEffect(() => {
    void refresh()
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh)
  }, [refresh])
  const requestAccess = async (video: boolean) => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video })
      s.getTracks().forEach((t) => t.stop())
      await refresh()
    } catch (e) {
      const name = (e as { name?: string }).name
      toast.error(name === 'NotAllowedError' ? 'Permissão negada. Libere microfone/câmera nas configurações do navegador ou do Windows.' : 'Nenhum dispositivo encontrado ou em uso por outro aplicativo.')
    }
  }
  return { devices, labelsHidden, requestAccess, refresh }
}

function useMediaPermissions() {
  const [p, setP] = useState<{ microphone: PermissionState | 'unknown'; camera: PermissionState | 'unknown' } | null>(null)
  useEffect(() => {
    let alive = true
    void queryMediaPermissions().then((r) => alive && setP(r))
    return () => {
      alive = false
    }
  }, [])
  return p
}

const PERM_LABEL: Record<string, { text: string; cls: string }> = {
  granted: { text: 'Permitido', cls: 'text-[var(--success-text)]' },
  denied: { text: 'Bloqueado', cls: 'text-[var(--danger-text)]' },
  prompt: { text: 'Vai perguntar ao usar', cls: 'text-fg-2' },
  unknown: { text: 'Desconhecido', cls: 'text-fg-muted' },
}

export function VoiceTab() {
  const { settings, updateVoice, update } = useSettings()
  const v = settings.voice
  const { devices, labelsHidden, requestAccess } = useDevices()
  const switchDevice = useVoice((s) => s.switchDevice)
  const refreshProcessor = useVoice((s) => s.refreshProcessor)
  const inputs = devices.filter((d) => d.kind === 'audioinput')
  const outputs = devices.filter((d) => d.kind === 'audiooutput')
  const cams = devices.filter((d) => d.kind === 'videoinput')

  /* -------- teste de microfone -------- */
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [loopback, setLoopback] = useState(false)
  const [sending, setSending] = useState(false)
  const [autoThr, setAutoThr] = useState(0)
  const perms = useMediaPermissions()
  const stop = useRef<(() => void) | null>(null)
  const loopRef = useRef(loopback)
  loopRef.current = loopback
  const muteEl = useRef<HTMLAudioElement | null>(null)
  useEffect(() => { if (muteEl.current) muteEl.current.muted = !loopback }, [loopback])
  const [chainStatus, setChainStatus] = useState<string | null>(null)
  const inCall = useVoice((s) => !!s.room)
  const liveChain = useVoice((s) => s.micChain)
  const [diag, setDiag] = useState<ReturnType<typeof diagnoseMic>>(null)
  useEffect(() => {
    if (!inCall) return setDiag(null)
    const tick = () => setDiag(diagnoseMic())
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [inCall, liveChain])

  useEffect(() => () => stop.current?.(), [])

  const startTest = async () => {
    try {
      const cur0 = useSettings.getState().settings.voice
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: cur0.inputId && cur0.inputId !== 'default' ? { exact: cur0.inputId } : undefined, ...captureConstraints(cur0.noiseMode, cur0.echoCancellation, cur0.autoGainControl) },
      })
      // a MESMA cadeia usada na chamada: o que passa aqui é exatamente o que seria enviado
      const chain = new MicChain()
      chain.configure({ mode: cur0.noiseMode, auto: cur0.autoSensitivity, sensitivity: cur0.sensitivity })
      chain.onMeter = (lvl, open, thr) => {
        const cur = useSettings.getState().settings.voice
        chain.core.opts = { auto: cur.autoSensitivity, sensitivity: cur.sensitivity }
        setLevel(lvl)
        setSending(open)
        setAutoThr(thr)
      }
      chain.onStatus = setChainStatus
      await chain.init({ track: stream.getAudioTracks()[0], kind: 'audio' } as never)
      const el = new Audio()
      el.srcObject = new MediaStream([chain.processedTrack!])
      el.muted = !loopRef.current
      muteEl.current = el
      const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
      if (cur0.outputId && sink.setSinkId) await sink.setSinkId(cur0.outputId).catch(() => undefined)
      void el.play().catch(() => undefined)
      setTesting(true)
      stop.current = () => {
        void chain.destroy()
        stream.getTracks().forEach((t) => t.stop())
        el.pause()
        muteEl.current = null
        setTesting(false)
        setLevel(0)
        setSending(false)
        setChainStatus(null)
        stop.current = null
      }
    } catch (e) {
      reportMediaError(e, 'microphone')
    }
  }
  // trocar o modo de supressão durante o teste reinicia a cadeia com o novo modo
  useEffect(() => {
    if (!stop.current) return
    stop.current()
    void startTest()
  }, [v.noiseMode, v.echoCancellation, v.autoGainControl])
  /* -------- teste de saída -------- */
  const testOutput = async () => {
    try {
      const ctx = new AudioContext()
      const dest = ctx.createMediaStreamDestination()
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      g.gain.value = 0.15
      osc.frequency.value = 523
      osc.connect(g).connect(dest)
      osc.start()
      const el = new Audio()
      el.srcObject = dest.stream
      const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
      if (v.outputId && sink.setSinkId) await sink.setSinkId(v.outputId)
      await el.play()
      setTimeout(() => { osc.stop(); void ctx.close(); el.pause() }, 700)
    } catch {
      toast.error('Não foi possível reproduzir o som de teste neste dispositivo.')
    }
  }

  /* -------- câmera -------- */
  const [camOn, setCamOn] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const camStream = useRef<MediaStream | null>(null)
  const stopCam = useCallback(() => {
    camStream.current?.getTracks().forEach((t) => t.stop())
    camStream.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamOn(false)
  }, [])
  useEffect(() => stopCam, [stopCam])
  const startCam = useCallback(async () => {
    stopCam()
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: v.cameraId ? { exact: v.cameraId } : undefined } })
      camStream.current = s
      if (videoRef.current) videoRef.current.srcObject = s
      setCamOn(true)
    } catch (e) {
      const name = (e as { name?: string }).name
      toast.error(name === 'NotAllowedError' ? 'Permissão da câmera negada.' : 'Câmera não encontrada ou em uso.')
    }
  }, [v.cameraId, stopCam])
  useEffect(() => { if (camOn) void startCam() }, [v.cameraId]) // eslint-disable-line react-hooks/exhaustive-deps

  const opt = (list: MediaDeviceInfo[], kind: string) =>
    list.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${kind} ${i + 1}`}</option>)

  return (
    <div className="mx-auto max-w-3xl">
      <H>Voz e vídeo</H>
      <div className="card mb-5">
        <div className="mb-2 font-semibold">Permissões deste {isTauri ? 'aplicativo' : 'site'}</div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {([['Microfone', perms?.microphone], ['Câmera', perms?.camera]] as const).map(([n, st]) => (
            <span key={n}>{n}: <strong className={PERM_LABEL[st ?? 'unknown'].cls}>{PERM_LABEL[st ?? 'unknown'].text}</strong></span>
          ))}
        </div>
        {(perms?.microphone === 'denied' || perms?.camera === 'denied') && (
          <details className="mt-2" open>
            <summary className="cursor-pointer font-semibold text-[var(--danger-text)]">Como liberar</summary>
            <ol className="mt-1 mb-0 list-decimal pl-5 text-fg-2">{permissionSteps(perms?.camera === 'denied' && perms?.microphone !== 'denied' ? 'camera' : 'microphone').map((s) => <li key={s}>{s}</li>)}</ol>
          </details>
        )}
        <div className="hint mt-2">O navegador/Windows pergunta na primeira vez que você usa. Nada é capturado sem a sua ação.</div>
      </div>
      {labelsHidden && (
        <div className="card mb-5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-fg-2">Para listar os nomes dos dispositivos, o navegador precisa de permissão.</span>
          <button className="btn btn-primary btn-sm" onClick={() => void requestAccess(false)}><Mic size={14} /> Permitir acesso</button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field"><label htmlFor="v-in">Microfone</label>
          <select id="v-in" className="select" value={v.inputId} onChange={(e) => { updateVoice({ inputId: e.target.value }); void switchDevice('audioinput', e.target.value) }}>
            <option value="default">Padrão do sistema</option>{opt(inputs, 'Microfone')}</select></div>
        <div className="field"><label htmlFor="v-out">Saída de áudio</label>
          <select id="v-out" className="select" value={v.outputId} disabled={outputs.length === 0} onChange={(e) => { updateVoice({ outputId: e.target.value }); void switchDevice('audiooutput', e.target.value) }}>
            <option value="default">Padrão do sistema</option>{opt(outputs, 'Saída')}</select>
          {outputs.length === 0 && <span className="hint">Seu navegador não permite escolher a saída de áudio.</span>}</div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn" onClick={() => void (testing ? stop.current?.() : startTest())}>{testing ? <MicOff size={15} /> : <Mic size={15} />} {testing ? 'Parar teste' : 'Testar microfone'}</button>
        <button className="btn" onClick={() => void testOutput()}><Play size={15} /> Testar saída</button>
      </div>

      <div className="mt-5">
        <div className="mb-1 flex justify-between text-xs">
          <span className="label">Nível do microfone (o que seria enviado)</span>
          {testing && <span className={sending ? 'font-semibold text-[var(--success-text)]' : 'text-fg-muted'}>{sending ? 'Transmitindo voz' : 'Silêncio / ruído filtrado'}</span>}
        </div>
        <div className="relative h-3 overflow-hidden rounded-full bg-tertiary" role="meter" aria-valuenow={Math.round(level)} aria-valuemin={0} aria-valuemax={100} aria-label="Nível do microfone">
          <div className="h-full rounded-full" style={{ width: `${level}%`, background: testing && sending ? 'var(--success)' : 'var(--text-muted)', transition: 'width 60ms linear' }} />
          {testing && <div className="absolute top-0 h-full w-0.5 bg-[var(--text-primary)]" style={{ left: `${v.autoSensitivity ? autoThr : v.sensitivity}%` }} aria-hidden />}
        </div>
        <div className="mt-1 text-xs text-fg-muted">{testing ? (loopback ? 'Você está se ouvindo — use fones para evitar eco!' : 'Fale normalmente: a barra deve ficar verde. O traço branco é o limite do filtro.') : 'Clique em “Testar microfone” para ver o nível ao vivo.'}</div>
        {testing && <label className="mt-2 flex items-center gap-2 text-fg-2"><input type="checkbox" checked={loopback} onChange={(e) => setLoopback(e.target.checked)} /> Ouvir o que está sendo enviado (use fones)</label>}
      </div>

      <div className="field mt-5"><label htmlFor="noise">Supressão de ruído</label>
        <select id="noise" className="select" value={v.noiseMode} onChange={(e) => { updateVoice({ noiseMode: e.target.value as NoiseMode }); refreshProcessor() }}>
          <option value="off">Nenhuma</option>
          <option value="browser">Padrão do navegador</option>
          <option value="high">Alta (recomendado)</option>
        </select>
        <span className="hint">“Alta” usa uma rede neural (RNNoise) que roda no seu computador e remove teclado, ventilador e ruído de fundo antes de enviar. Nada sai do seu aparelho além da sua voz.</span>
        {(chainStatus ?? diag?.chain) === 'rnnoise-failed' && <span className="hint text-[var(--danger-text)]">Não foi possível carregar o filtro de Alta qualidade neste ambiente; usando apenas a porta de ruído.</span>}
      </div>
      {inCall && (
        <p className="hint mt-1">
          Diagnóstico da chamada: {diag === null ? 'microfone ainda não está publicado (ligue o microfone na chamada).' : `${diag.published ? 'a faixa enviada passa pelo filtro' : 'a faixa enviada NÃO passa pelo filtro'} · cadeia: ${diag.chain === 'rnnoise' ? 'RNNoise + porta de ruído' : diag.chain === 'gate-only' ? 'só porta de ruído' : diag.chain ?? 'inativa'}${diag.muted ? ' · microfone mudo' : ''}`}
        </p>
      )}
      <SettingRow title="Sensibilidade de entrada automática" description="Aprende o ruído do ambiente e só transmite quando você fala acima dele. Desligue para ajustar à mão.">
        <Toggle checked={v.autoSensitivity} onChange={(a) => { updateVoice({ autoSensitivity: a }); refreshProcessor() }} label="Sensibilidade automática" />
      </SettingRow>
      {!v.autoSensitivity && (
        <div className="field mb-2"><label htmlFor="sens">Limite do filtro: {v.sensitivity === 0 ? 'desligado (envia tudo)' : v.sensitivity}</label>
          <input id="sens" type="range" min={0} max={100} step={1} value={v.sensitivity} onChange={(e) => { updateVoice({ sensitivity: Number(e.target.value) }); refreshProcessor() }} aria-valuetext={`${v.sensitivity} de 100`} />
          <span className="hint">Clique em “Testar microfone” e ajuste: o ruído deve ficar abaixo do traço e a sua voz acima. Mais para a direita filtra mais; no máximo quase nada passa.</span></div>
      )}      <SettingRow title="Cancelamento de eco"><Toggle checked={v.echoCancellation} onChange={(a) => updateVoice({ echoCancellation: a })} label="Cancelamento de eco" /></SettingRow>
      <SettingRow title="Controle automático de ganho"><Toggle checked={v.autoGainControl} onChange={(a) => updateVoice({ autoGainControl: a })} label="Controle automático de ganho" /></SettingRow>
      <SettingRow title="Considerar a minha voz como atividade" description="Enquanto você fala (ou transmite), o canal de ausentes não te move por inatividade."><Toggle checked={settings.afk.voiceCounts} onChange={(a) => update({ afk: { voiceCounts: a } })} label="Voz conta como atividade" /></SettingRow>
      <SettingRow title="Entrar em chamadas com o microfone silenciado"><Toggle checked={v.joinMuted} onChange={(a) => updateVoice({ joinMuted: a })} label="Entrar silenciado" /></SettingRow>

      <div className="divider" />
      <h3 className="mt-0">Push-to-talk</h3>
      <SettingRow title="Usar push-to-talk" description={`Só transmite enquanto a tecla ${codeLabel(settings.keybinds.pushToTalk)} estiver pressionada (com a janela do app em foco). Altere em Atalhos.`}>
        <Toggle checked={v.pttEnabled} onChange={(a) => { updateVoice({ pttEnabled: a }); refreshProcessor() }} label="Usar push-to-talk" />
      </SettingRow>

      <div className="divider" />
      <h3 className="mt-0">Vídeo</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field"><label htmlFor="v-cam">Câmera</label>
          <select id="v-cam" className="select" value={v.cameraId} onChange={(e) => { updateVoice({ cameraId: e.target.value }); if (e.target.value) void switchDevice('videoinput', e.target.value) }}>
            <option value="">Padrão do sistema</option>{opt(cams, 'Câmera')}</select></div>
        <div className="field"><label htmlFor="v-cq">Qualidade da câmera</label>
          <select id="v-cq" className="select" value={v.cameraQuality} onChange={(e) => updateVoice({ cameraQuality: e.target.value as typeof v.cameraQuality })}><option value="360p">360p (econômico)</option><option value="720p">720p</option><option value="1080p">1080p</option></select></div>
      </div>
      <div className="relative mt-3 overflow-hidden rounded-lg bg-black" style={{ aspectRatio: '16/9', maxWidth: 360 }}>
        <video ref={videoRef} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" aria-label="Pré-visualização da câmera" />
        {!camOn && <div className="absolute inset-0 grid place-items-center text-fg-muted"><VideoOff /></div>}
      </div>
      <button className="btn mt-3" onClick={() => void (camOn ? stopCam() : startCam())}>{camOn ? <VideoOff size={15} /> : <Video size={15} />} {camOn ? 'Desligar pré-visualização' : 'Testar câmera'}</button>

      <div className="divider" />
      <h3 className="mt-0">Compartilhamento de tela</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field"><label htmlFor="v-sq">Resolução</label>
          <select id="v-sq" className="select" value={v.screenQuality === '720p' ? '720p' : '1080p'} onChange={(e) => updateVoice({ screenQuality: e.target.value as typeof v.screenQuality })}><option value="720p">720p</option><option value="1080p">1080p</option></select></div>
        <div className="field"><label htmlFor="v-fps">Quadros por segundo</label>
          <select id="v-fps" className="select" value={v.screenFps === 60 ? 60 : 30} onChange={(e) => updateVoice({ screenFps: Number(e.target.value) as typeof v.screenFps })}><option value={30}>30 fps</option><option value={60}>60 fps</option></select></div>
      </div>
      <SettingRow title="Tentar compartilhar áudio do sistema" description="Depende do navegador e do sistema: no Windows, Chrome/Edge permitem ao compartilhar a tela inteira ou uma aba."><Toggle checked={v.screenAudio} onChange={(a) => updateVoice({ screenAudio: a })} label="Compartilhar áudio do sistema" /></SettingRow>
      <p className="hint">Qualidade maior usa mais banda de subida e CPU — veja docs/COSTS.md para limites do plano gratuito.</p>
    </div>
  )
}
