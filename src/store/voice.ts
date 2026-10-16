import { create } from 'zustand'
import {
  AudioPresets,
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type AudioProcessorOptions,
  type TrackProcessor,
} from 'livekit-client'
import { supabase } from '@/lib/supabase'
import { useSettings } from './settings'
import { toast } from './ui'
import { playSound } from '@/lib/sounds'
import { GateCore, levelFromDb } from '@/lib/gate'
import { screenPreset } from '@/lib/screen'
import { reportMediaError, type MediaKind } from '@/lib/mediaErrors'

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

export interface VoiceParticipant {
  identity: string
  name: string
  isLocal: boolean
  speaking: boolean
  micOn: boolean
  camOn: boolean
  screenOn: boolean
  quality: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'
}

export interface VoiceTarget {
  id: string
  serverId: string
  name: string
}

interface VoiceState {
  room: Room | null
  target: VoiceTarget | null
  channelId: string | null
  status: VoiceStatus
  error: string | null
  participants: VoiceParticipant[]
  /** incrementa quando tracks mudam, para re-renderizar tiles de vídeo */
  version: number
  micMuted: boolean
  deafened: boolean
  camOn: boolean
  screenOn: boolean
  pttActive: boolean
  volumes: Record<string, number>
  focus: string | null
  /** Latência (RTT) até o servidor de mídia, em ms; null enquanto não medida. */
  ping: number | null
  /** Medidor do microfone enviado (0–100), se o gate está aberto e o limite atual. */
  micLevel: number
  micOpen: boolean
  micThreshold: number
  /** Silenciado/ensurdecido por um moderador do servidor (não dá para desfazer sozinho). */
  serverMuted: boolean
  serverDeafened: boolean
  setServerFlags: (muted: boolean, deafened: boolean) => void
  join: (t: VoiceTarget) => Promise<void>
  leave: () => Promise<void>
  retry: () => Promise<void>
  toggleMic: () => Promise<void>
  toggleDeafen: () => Promise<void>
  toggleCamera: () => Promise<void>
  toggleScreen: () => Promise<void>
  setPtt: (active: boolean) => void
  setVolume: (identity: string, v: number) => void
  setFocus: (key: string | null) => void
  switchDevice: (kind: 'audioinput' | 'audiooutput' | 'videoinput', id: string) => Promise<void>
  refreshProcessor: () => void
}

const VOL_KEY = 'vibe.volumes'
function loadVolumes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(VOL_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

export { levelFromDb } from '@/lib/gate'

/**
 * Processador de áudio local: filtro passa-alta + porta de ruído (noise gate) via WebAudio.
 * Fica entre a captura e o envio; mute/PTT continuam sendo aplicados na própria track.
 * A decisão de abrir/fechar vem do GateCore (lógica pura e testada).
 */
class MicGateProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'vibe-mic-gate'
  processedTrack?: MediaStreamTrack
  readonly core = new GateCore({ auto: true, sensitivity: 35 })
  /** Recebe (nível 0–100, aberto, limite 0–100) ~10x por segundo. */
  onMeter?: (level: number, open: boolean, threshold: number) => void
  private nodes: AudioNode[] = []
  private timer?: ReturnType<typeof setInterval>
  private ticks = 0

  async init(opts: AudioProcessorOptions) {
    const ctx = opts.audioContext
    const source = ctx.createMediaStreamSource(new MediaStream([opts.track]))
    const highpass = ctx.createBiquadFilter() // remove zumbido/vibração abaixo de ~90 Hz
    highpass.type = 'highpass'
    highpass.frequency.value = 90
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    const gain = ctx.createGain()
    const dest = ctx.createMediaStreamDestination()
    source.connect(highpass)
    highpass.connect(analyser)
    highpass.connect(gain)
    gain.connect(dest)
    this.nodes = [source, highpass, analyser, gain]
    this.processedTrack = dest.stream.getAudioTracks()[0]
    this.core.reset()
    const buf = new Float32Array(analyser.fftSize)
    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-9)
      const now = performance.now()
      const open = this.core.update(db, now)
      gain.gain.setTargetAtTime(open ? 1 : 0, ctx.currentTime, open ? 0.005 : 0.05)
      if (++this.ticks % 5 === 0) this.onMeter?.(levelFromDb(db), open, levelFromDb(this.core.thresholdDb))
    }, 20)
  }
  async restart(opts: AudioProcessorOptions) {
    await this.destroy()
    await this.init(opts)
  }
  async destroy() {
    clearInterval(this.timer)
    this.nodes.forEach((n) => n.disconnect())
    this.nodes = []
    this.processedTrack = undefined
  }
}
/** Mede o RTT do par ICE ativo (WebRTC getStats). Retorna null se indisponível. */
async function measureRtt(room: Room): Promise<number | null> {
  try {
    const pcm = (room.engine as unknown as { pcManager?: { publisher?: { getStats?: () => Promise<RTCStatsReport> }; subscriber?: { getStats?: () => Promise<RTCStatsReport> } } }).pcManager
    for (const t of [pcm?.subscriber, pcm?.publisher]) {
      const report = await t?.getStats?.()
      if (!report) continue
      let rtt: number | null = null
      report.forEach((r: { type?: string; state?: string; nominated?: boolean; currentRoundTripTime?: number }) => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated && typeof r.currentRoundTripTime === 'number') rtt = Math.round(r.currentRoundTripTime * 1000)
      })
      if (rtt !== null) return rtt
    }
  } catch {
    /* indisponível */
  }
  return null
}

let pingTimer: ReturnType<typeof setInterval> | undefined

let gate: MicGateProcessor | null = null
let audioContainer: HTMLDivElement | null = null
let userLeft = false
let retries = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined
let previousMicMuted = false

function container(): HTMLDivElement {
  if (!audioContainer) {
    audioContainer = document.createElement('div')
    audioContainer.id = 'voice-audio'
    audioContainer.style.display = 'none'
    document.body.appendChild(audioContainer)
  }
  return audioContainer
}

const QUALITY: Record<ConnectionQuality, VoiceParticipant['quality']> = {
  [ConnectionQuality.Excellent]: 'excellent',
  [ConnectionQuality.Good]: 'good',
  [ConnectionQuality.Poor]: 'poor',
  [ConnectionQuality.Lost]: 'lost',
  [ConnectionQuality.Unknown]: 'unknown',
}

function snapshot(room: Room): VoiceParticipant[] {
  const all = [room.localParticipant, ...room.remoteParticipants.values()]
  return all.map((p) => ({
    identity: p.identity,
    name: p.name || p.identity,
    isLocal: p === room.localParticipant,
    speaking: p.isSpeaking,
    micOn: p.isMicrophoneEnabled,
    camOn: p.isCameraEnabled,
    screenOn: p.isScreenShareEnabled,
    quality: QUALITY[p.connectionQuality] ?? 'unknown',
  }))
}

export async function fetchVoiceToken(channelId: string): Promise<{ token: string; url: string }> {
  const { data, error } = await supabase.functions.invoke('livekit-token', { body: { channelId } })
  if (error) {
    let code = ''
    try {
      const ctx = (error as unknown as { context?: Response }).context
      code = ctx ? ((await ctx.json()) as { error?: string }).error ?? '' : ''
    } catch {
      /* corpo ilegível */
    }
    if (code === 'livekit_not_configured')
      throw new Error('O LiveKit não está configurado no servidor (secrets LIVEKIT_URL / API_KEY / API_SECRET). Veja docs/LIVEKIT.md.')
    if (code === 'forbidden') throw new Error('Você não tem permissão para entrar neste canal de voz.')
    if (code === 'rate_limited') throw new Error('Muitas tentativas de conexão. Aguarde um minuto.')
    if (/Failed to send a request|fetch/i.test(error.message))
      throw new Error('Não foi possível contatar a função "livekit-token". Ela foi publicada no Supabase? Veja docs/SETUP.md.')
    throw new Error('Falha ao obter acesso à sala de voz.')
  }
  const d = data as { token?: string; url?: string }
  if (!d?.token || !d.url) throw new Error('Resposta inválida do servidor de voz.')
  return { token: d.token, url: d.url }
}

function videoRes(q: '360p' | '720p' | '1080p') {
  return q === '360p' ? VideoPresets.h360.resolution : q === '720p' ? VideoPresets.h720.resolution : VideoPresets.h1080.resolution
}

/** Janela em que uma remoção da sala é parte de um 'mover' feito por moderador (não é erro). */
let moveUntil = 0
export function expectModeratorMove() {
  moveUntil = Date.now() + 8000
}

export const useVoice = create<VoiceState>((set, get) => {
  const sync = (bumpVersion = true) => {
    const room = get().room
    if (!room) return
    set((s) => ({
      participants: snapshot(room),
      version: bumpVersion ? s.version + 1 : s.version,
      camOn: room.localParticipant.isCameraEnabled,
      screenOn: room.localParticipant.isScreenShareEnabled,
    }))
  }

  const applyVolumes = () => {
    const { room, volumes, deafened, serverDeafened } = get()
    if (!room) return
    for (const p of room.remoteParticipants.values()) {
      const v = deafened || serverDeafened ? 0 : (volumes[p.identity] ?? 1)
      p.setVolume(v, Track.Source.Microphone)
      p.setVolume(v, Track.Source.ScreenShareAudio)
    }
  }

  /** Decide se o microfone transmite agora (mute, ensurdecido, push-to-talk). */
  const applyMic = async () => {
    const { room, micMuted, deafened, pttActive, serverMuted } = get()
    if (!room || room.state !== ConnectionState.Connected) return
    const ptt = useSettings.getState().settings.voice.pttEnabled
    const want = !micMuted && !deafened && !serverMuted && (!ptt || pttActive)
    const lp = room.localParticipant
    const pub = lp.getTrackPublication(Track.Source.Microphone)
    try {
      if (!pub?.track) {
        if (want) await lp.setMicrophoneEnabled(true)
        else return
        await installGate()
        return
      }
      if (want && pub.isMuted) await pub.track.unmute()
      if (!want && !pub.isMuted) await pub.track.mute()
    } catch (e) {
      handleMediaError(e, 'microfone')
    }
    sync()
  }

  const installGate = async () => {
    const room = get().room
    const track = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
    if (!(track instanceof LocalAudioTrack)) return
    const v = useSettings.getState().settings.voice
    gate ??= new MicGateProcessor()
    gate.core.opts = { auto: v.autoSensitivity, sensitivity: v.sensitivity }
    gate.onMeter = (micLevel, micOpen, micThreshold) => set({ micLevel, micOpen, micThreshold })
    if (track.getProcessor?.() !== gate) {
      try {
        await track.setProcessor(gate)
      } catch {
        gate = null // navegador sem suporte: segue sem porta de ruído
      }
    }
  }

  const handleMediaError = (e: unknown, what: string) => {
    const kind: MediaKind = what === 'câmera' ? 'camera' : what === 'tela' ? 'screen' : what.startsWith('saída') ? 'speaker' : 'microphone'
    const problem = reportMediaError(e, kind)
    // dispositivo salvo não existe mais: volta ao padrão do sistema para a próxima tentativa
    if (problem === 'overconstrained' || problem === 'notfound') {
      const { updateVoice } = useSettings.getState()
      if (kind === 'microphone') updateVoice({ inputId: 'default' })
      else if (kind === 'camera') updateVoice({ cameraId: '' })
      else if (kind === 'speaker') updateVoice({ outputId: 'default' })
    }
  }

  /** Se o dispositivo escolhido foi desconectado durante a chamada, avisa e volta ao padrão. */
  const checkDevices = async (room: Room) => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const has = (kind: MediaDeviceKind, id: string) => !id || id === 'default' || list.some((d) => d.kind === kind && d.deviceId === id)
      const v = useSettings.getState().settings.voice
      const { updateVoice } = useSettings.getState()
      if (!has('audioinput', v.inputId)) {
        toast.info('O microfone escolhido foi desconectado. Usando o padrão do sistema.')
        updateVoice({ inputId: 'default' })
        await room.switchActiveDevice('audioinput', 'default').catch(() => undefined)
      }
      if (!has('audiooutput', v.outputId)) {
        toast.info('A saída de áudio escolhida foi desconectada. Usando o padrão do sistema.')
        updateVoice({ outputId: 'default' })
        await room.switchActiveDevice('audiooutput', 'default').catch(() => undefined)
      }
      if (v.cameraId && !has('videoinput', v.cameraId)) {
        toast.info('A câmera escolhida foi desconectada.')
        updateVoice({ cameraId: '' })
        if (room.localParticipant.isCameraEnabled) await room.localParticipant.setCameraEnabled(false).catch(() => undefined)
      }
    } catch {
      /* sem permissão de listagem */
    }
    sync()
  }
  const wire = (room: Room) => {
    const touch = () => sync()
    room
      .on(RoomEvent.ParticipantConnected, () => {
        playSound('join')
        sync()
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        playSound('leave')
        sync()
      })
      .on(RoomEvent.ActiveSpeakersChanged, () => sync(false))
      .on(RoomEvent.TrackMuted, touch)
      .on(RoomEvent.TrackUnmuted, touch)
      .on(RoomEvent.TrackPublished, touch)
      .on(RoomEvent.TrackUnpublished, touch)
      .on(RoomEvent.LocalTrackPublished, touch)
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === Track.Source.ScreenShare) toast.info('Compartilhamento de tela encerrado.')
        sync()
      })
      .on(RoomEvent.ConnectionQualityChanged, () => sync(false))
      .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach()
          el.dataset.identity = participant.identity
          container().appendChild(el)
          applyVolumes()
        }
        sync()
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove())
        sync()
      })
      .on(RoomEvent.Reconnecting, () => set({ status: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => {
        set({ status: 'connected', error: null })
        sync()
      })
      .on(RoomEvent.MediaDevicesChanged, () => void checkDevices(room))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!room.canPlaybackAudio) void room.startAudio().catch(() => undefined)
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (get().room !== room) return
        track_cleanup()
        stopPing()
        if (userLeft || reason === DisconnectReason.CLIENT_INITIATED) return
        if (reason === DisconnectReason.PARTICIPANT_REMOVED && Date.now() < moveUntil) return // movido por moderador: o comando de mover reconecta no destino
        if (reason === DisconnectReason.PARTICIPANT_REMOVED || reason === DisconnectReason.ROOM_DELETED) {
          set({ status: 'failed', error: 'Você foi removido da chamada.', room: null, channelId: null, participants: [] })
          return
        }
        set({ status: 'reconnecting', error: 'Conexão perdida. Tentando reconectar…' })
        scheduleRetry()
      })
  }

  const track_cleanup = () => {
    audioContainer?.replaceChildren()
  }

  const startPing = () => {
    clearInterval(pingTimer)
    const tick = async () => {
      const room = get().room
      if (!room || room.state !== ConnectionState.Connected) return
      set({ ping: await measureRtt(room) })
    }
    void tick()
    pingTimer = setInterval(() => void tick(), 3000)
  }
  const stopPing = () => {
    clearInterval(pingTimer)
    set({ ping: null })
  }

  const scheduleRetry = () => {
    clearTimeout(retryTimer)
    if (retries >= 6) {
      set({ status: 'failed', error: 'Não foi possível reconectar à chamada. Verifique sua conexão.' })
      return
    }
    const delay = Math.min(1000 * 2 ** retries, 15000)
    retries++
    retryTimer = setTimeout(() => void get().retry(), delay)
  }

  const connectRoom = async (target: VoiceTarget) => {
    const s = useSettings.getState().settings.voice
    const { token, url } = await fetchVoiceToken(target.id)
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      stopLocalTrackOnUnpublish: true,
      disconnectOnPageLeave: true,
      audioCaptureDefaults: {
        deviceId: s.inputId || undefined,
        echoCancellation: s.echoCancellation,
        noiseSuppression: s.noiseSuppression,
        autoGainControl: s.autoGainControl,
        channelCount: 1,
      },
      audioOutput: { deviceId: s.outputId || undefined },
      videoCaptureDefaults: { deviceId: s.cameraId || undefined, resolution: videoRes(s.cameraQuality) },
      publishDefaults: {
        audioPreset: AudioPresets.speech,
        dtx: true,
        red: true,
        simulcast: true,
        videoCodec: 'vp8',
      },
    })
    wire(room)
    set({ room, target, channelId: target.id, participants: [] })
    await room.connect(url, token, { autoSubscribe: true })
    return room
  }

  return {
    room: null,
    target: null,
    channelId: null,
    status: 'idle',
    error: null,
    participants: [],
    version: 0,
    micMuted: false,
    deafened: false,
    camOn: false,
    screenOn: false,
    pttActive: false,
    volumes: loadVolumes(),
    focus: null,
    ping: null,
    micLevel: 0,
    micOpen: false,
    micThreshold: 0,
    serverMuted: false,
    serverDeafened: false,
    setServerFlags: (serverMuted, serverDeafened) => {
      const prev = get()
      if (prev.serverMuted === serverMuted && prev.serverDeafened === serverDeafened) return
      set({ serverMuted, serverDeafened })
      if (prev.room) {
        if (serverMuted && !prev.serverMuted) toast.info('Um moderador silenciou o seu microfone neste servidor.')
        if (!serverMuted && prev.serverMuted) toast.info('Seu microfone foi liberado.')
        if (serverDeafened && !prev.serverDeafened) toast.info('Um moderador desativou o seu áudio neste servidor.')
        if (!serverDeafened && prev.serverDeafened) toast.info('Seu áudio foi liberado.')
      }
      applyVolumes()
      void applyMic()
    },

    join: async (target) => {
      if (get().channelId === target.id && get().status !== 'failed') return
      if (get().room) await get().leave()
      userLeft = false
      retries = 0
      const s = useSettings.getState().settings.voice
      set({ status: 'connecting', error: null, target, channelId: target.id, micMuted: s.joinMuted || s.pttEnabled, deafened: false, focus: null })
      try {
        const room = await connectRoom(target)
        set({ status: 'connected' })
        startPing()
        playSound('join')
        try {
          await room.startAudio()
        } catch {
          /* autoplay: será retomado no primeiro clique */
        }
        sync()
        await applyMic()
        applyVolumes()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha ao conectar.'
        get().room?.disconnect().catch(() => undefined)
        set({ status: 'failed', error: msg, room: null, channelId: null, participants: [] })
        toast.error(msg)
      }
    },

    leave: async () => {
      userLeft = true
      clearTimeout(retryTimer)
      stopPing()
      set({ micLevel: 0, micOpen: false })
      const room = get().room
      set({ room: null, channelId: null, target: null, status: 'idle', error: null, participants: [], camOn: false, screenOn: false, focus: null, pttActive: false })
      if (room) {
        try {
          await room.disconnect()
        } catch {
          /* já desconectado */
        }
        playSound('leave')
      }
      track_cleanup()
      gate = null
    },

    retry: async () => {
      const target = get().target
      if (!target) return
      const old = get().room
      set({ status: 'connecting', error: null })
      userLeft = false
      try {
        if (old) {
          old.removeAllListeners()
          await old.disconnect().catch(() => undefined)
        }
        gate = null
        track_cleanup()
        const room = await connectRoom(target)
        retries = 0
        set({ status: 'connected', error: null })
        startPing()
        await room.startAudio().catch(() => undefined)
        sync()
        await applyMic()
        applyVolumes()
        toast.success('Reconectado à chamada.')
      } catch (e) {
        if (userLeft || !get().target) return
        set({ status: 'reconnecting', error: e instanceof Error ? e.message : 'Falha ao reconectar.' })
        scheduleRetry()
      }
    },

    toggleMic: async () => {
      if (get().serverMuted) return void toast.error('Você foi silenciado por um moderador e não pode ativar o microfone agora.')
      const { micMuted, deafened } = get()
      if (deafened) {
        // sair do modo ensurdecido ao ativar o microfone (comportamento esperado)
        set({ deafened: false, micMuted: false })
        playSound('undeafen')
        applyVolumes()
      } else {
        set({ micMuted: !micMuted })
        playSound(micMuted ? 'unmute' : 'mute')
      }
      await applyMic()
    },

    toggleDeafen: async () => {
      const { deafened, micMuted } = get()
      if (!deafened) {
        previousMicMuted = micMuted
        set({ deafened: true, micMuted: true })
        playSound('deafen')
      } else {
        set({ deafened: false, micMuted: previousMicMuted })
        playSound('undeafen')
      }
      applyVolumes()
      await applyMic()
    },

    toggleCamera: async () => {
      const room = get().room
      if (!room) return
      if (get().serverMuted && !room.localParticipant.isCameraEnabled) return void toast.error('Você foi silenciado por um moderador e não pode ligar a câmera agora.')
      const s = useSettings.getState().settings.voice
      try {
        await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled, {
          deviceId: s.cameraId || undefined,
          resolution: videoRes(s.cameraQuality),
        })
      } catch (e) {
        handleMediaError(e, 'câmera')
      }
      sync()
    },

    toggleScreen: async () => {
      const room = get().room
      if (!room) return
      if (!navigator.mediaDevices?.getDisplayMedia) {
        toast.error('Seu navegador/sistema não suporta compartilhamento de tela.')
        return
      }
      const lp = room.localParticipant
      const s = useSettings.getState().settings.voice
      if (get().serverMuted && !lp.isScreenShareEnabled) return void toast.error('Você foi silenciado por um moderador e não pode compartilhar a tela agora.')
      try {
        if (lp.isScreenShareEnabled) {
          await lp.setScreenShareEnabled(false)
        } else {
          const p = screenPreset(s.screenQuality, s.screenFps)
          await lp.setScreenShareEnabled(
            true,
            {
              audio: s.screenAudio,
              resolution: p.resolution,
              contentHint: p.fps === 60 ? 'motion' : 'detail',
              selfBrowserSurface: 'exclude',
              surfaceSwitching: 'include',
              systemAudio: s.screenAudio ? 'include' : 'exclude',
            },
            { screenShareEncoding: { maxBitrate: p.maxBitrate, maxFramerate: p.fps } },
          )
          if (s.screenAudio && !lp.getTrackPublication(Track.Source.ScreenShareAudio)) {
            toast.info(
              'Tela compartilhada sem áudio do sistema. No seletor, marque "Compartilhar áudio do sistema" (disponível ao compartilhar a tela inteira ou uma aba no Chrome/Edge no Windows).',
            )
          }
        }
      } catch (e) {
        handleMediaError(e, 'tela')
      }
      sync()
    },

    setPtt: (active) => {
      if (get().pttActive === active) return
      set({ pttActive: active })
      void applyMic()
    },

    setVolume: (identity, v) => {
      const volumes = { ...get().volumes, [identity]: v }
      set({ volumes })
      try {
        localStorage.setItem(VOL_KEY, JSON.stringify(volumes))
      } catch {
        /* sem storage */
      }
      applyVolumes()
    },

    setFocus: (focus) => set({ focus }),

    switchDevice: async (kind, id) => {
      const room = get().room
      if (!room) return
      try {
        await room.switchActiveDevice(kind, id)
      } catch (e) {
        handleMediaError(e, kind === 'audiooutput' ? 'saída de áudio' : kind === 'audioinput' ? 'microfone' : 'câmera')
      }
    },

    refreshProcessor: () => {
      const v = useSettings.getState().settings.voice
      if (gate) gate.core.opts = { auto: v.autoSensitivity, sensitivity: v.sensitivity }
      else void installGate()
      void applyMic()
    },
  }
})
