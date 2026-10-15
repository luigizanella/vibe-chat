import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Play, Video, VideoOff } from 'lucide-react'
import { useSettings } from '@/store/settings'
import { levelFromDb, useVoice } from '@/store/voice'
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

export function VoiceTab() {
  const { settings, updateVoice } = useSettings()
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
  const stop = useRef<(() => void) | null>(null)
  const loopRef = useRef(loopback)
  loopRef.current = loopback

  useEffect(() => () => stop.current?.(), [])

  const startTest = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: v.inputId && v.inputId !== 'default' ? { exact: v.inputId } : undefined, echoCancellation: v.echoCancellation, noiseSuppression: v.noiseSuppression, autoGainControl: v.autoGainControl },
      })
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      src.connect(analyser)
      const dest = ctx.createMediaStreamDestination()
      const gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(gain).connect(dest)
      const el = new Audio()
      el.srcObject = dest.stream
      const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
      if (v.outputId && sink.setSinkId) await sink.setSinkId(v.outputId).catch(() => undefined)
      void el.play().catch(() => undefined)
      const buf = new Float32Array(analyser.fftSize)
      let raf = 0
      const tick = () => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        setLevel(levelFromDb(20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-9)))
        gain.gain.value = loopRef.current ? 1 : 0
        raf = requestAnimationFrame(tick)
      }
      tick()
      setTesting(true)
      stop.current = () => {
        cancelAnimationFrame(raf)
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close()
        el.pause()
        setTesting(false)
        setLevel(0)
        stop.current = null
      }
    } catch (e) {
      const name = (e as { name?: string }).name
      toast.error(name === 'NotAllowedError' ? 'Permissão do microfone negada.' : 'Não foi possível abrir o microfone selecionado.')
    }
  }

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
    <div className="max-w-xl">
      <H>Voz e vídeo</H>
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
        <div className="mb-1 flex justify-between text-xs"><span className="label">Nível do microfone</span>{testing && <span className="text-fg-muted">{loopback ? 'Você está se ouvindo — use fones!' : 'Fale algo'}</span>}</div>
        <div className="relative h-3 overflow-hidden rounded-full bg-tertiary" role="meter" aria-valuenow={Math.round(level)} aria-valuemin={0} aria-valuemax={100} aria-label="Nível do microfone">
          <div className="h-full rounded-full" style={{ width: `${level}%`, background: !v.autoSensitivity && level < v.sensitivity ? 'var(--text-muted)' : 'var(--success)', transition: 'width 60ms linear' }} />
          {!v.autoSensitivity && <div className="absolute top-0 h-full w-0.5 bg-white" style={{ left: `${v.sensitivity}%` }} />}
        </div>
        {testing && <label className="mt-2 flex items-center gap-2 text-fg-2"><input type="checkbox" checked={loopback} onChange={(e) => setLoopback(e.target.checked)} /> Ouvir meu próprio microfone (risco de eco sem fones)</label>}
      </div>

      <SettingRow title="Sensibilidade automática" description="Desligue para definir o limite abaixo do qual o microfone é silenciado.">
        <Toggle checked={v.autoSensitivity} onChange={(a) => { updateVoice({ autoSensitivity: a }); refreshProcessor() }} label="Sensibilidade automática" />
      </SettingRow>
      {!v.autoSensitivity && (
        <div className="field"><label htmlFor="sens">Limite de sensibilidade: {v.sensitivity}</label>
          <input id="sens" type="range" min={1} max={90} value={v.sensitivity} onChange={(e) => { updateVoice({ sensitivity: Number(e.target.value) }); refreshProcessor() }} />
          <span className="hint">Fale normalmente: a barra verde deve passar do marcador branco.</span></div>
      )}
      <SettingRow title="Supressão de ruído" description="Filtro do navegador. Aplica-se ao entrar na próxima chamada."><Toggle checked={v.noiseSuppression} onChange={(a) => updateVoice({ noiseSuppression: a })} label="Supressão de ruído" /></SettingRow>
      <SettingRow title="Cancelamento de eco"><Toggle checked={v.echoCancellation} onChange={(a) => updateVoice({ echoCancellation: a })} label="Cancelamento de eco" /></SettingRow>
      <SettingRow title="Controle automático de ganho"><Toggle checked={v.autoGainControl} onChange={(a) => updateVoice({ autoGainControl: a })} label="Controle automático de ganho" /></SettingRow>
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
          <select id="v-sq" className="select" value={v.screenQuality} onChange={(e) => updateVoice({ screenQuality: e.target.value as typeof v.screenQuality })}><option value="720p">720p</option><option value="1080p">1080p</option><option value="1440p">1440p</option></select></div>
        <div className="field"><label htmlFor="v-fps">Quadros por segundo</label>
          <select id="v-fps" className="select" value={v.screenFps} onChange={(e) => updateVoice({ screenFps: Number(e.target.value) as typeof v.screenFps })}><option value={15}>15 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></select></div>
      </div>
      <SettingRow title="Tentar compartilhar áudio do sistema" description="Depende do navegador e do sistema: no Windows, Chrome/Edge permitem ao compartilhar a tela inteira ou uma aba."><Toggle checked={v.screenAudio} onChange={(a) => updateVoice({ screenAudio: a })} label="Compartilhar áudio do sistema" /></SettingRow>
      <p className="hint">Qualidade maior usa mais banda de subida e CPU — veja docs/COSTS.md para limites do plano gratuito.</p>
    </div>
  )
}
