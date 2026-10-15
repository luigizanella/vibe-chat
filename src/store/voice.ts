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

/** Mapeia nível RMS (dBFS) para 0–100, igual ao medidor das configurações. */
export function levelFromDb(db: number): number {
  return Math.max(0, Math.min(100, ((db + 70) / 70) * 100))
}

/**
 * Processador de áudio local: porta de ruído (sensibilidade do microfone) via WebAudio.
 * Fica entre a captura e o envio; o mute/PTT continuam sendo aplicados na própria track.
 */
class MicGateProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'vibe-mic-gate'
  processedTrack?: MediaStreamTrack
  private ctx?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private analyser?: AnalyserNode
  private gain?: GainNode
  private dest?: MediaStreamAudioDestinationNode
  private timer?: ReturnType<typeof setInterval>
  private holdUntil = 0
  threshold = 20
  enabled = false

  async init(opts: AudioProcessorOptions) {
    this.ctx = opts.audioContext
    this.source = this.ctx.createMediaStreamSource(new MediaStream([opts.track]))
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.gain = this.ctx.createGain()
    this.dest = this.ctx.createMediaStreamDestination()
    this.source.connect(this.analyser)
    this.source.connect(this.gain)
    this.gain.connect(this.dest)
    this.processedTrack = this.dest.stream.getAudioTracks()[0]
    const buf = new Float32Array(this.analyser.fftSize)
    this.timer = setInterval(() => {
      if (!this.analyser || !this.gain || !this.ctx) return
      if (!this.enabled) {
        this.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.01)
        return
      }
      this.analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-9)
      const now = performance.now()
      if (levelFromDb(db) >= this.threshold) this.holdUntil = now + 300
      this.gain.gain.setTargetAtTime(now < this.holdUntil ? 1 : 0, this.ctx.currentTime, now < this.holdUntil ? 0.005 : 0.04)
    }, 20)
  }
  async restart(opts: AudioProcessorOptions) {
    await this.destroy()
    await this.init(opts)
  }
  async destroy() {
    clearInterval(this.timer)
    this.source?.disconnect()
    this.gain?.disconnect()
    this.analyser?.disconnect()
    this.processedTrack = undefined
  }
}

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

function screenRes(q: '720p' | '1080p' | '1440p', fps: number) {
  const dims = q === '720p' ? [1280, 720] : q === '1080p' ? [1920, 1080] : [2560, 1440]
  return { width: dims[0], height: dims[1], frameRate: fps }
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
    const { room, volumes, deafened } = get()
    if (!room) return
    for (const p of room.remoteParticipants.values()) {
      const v = deafened ? 0 : (volumes[p.identity] ?? 1)
      p.setVolume(v, Track.Source.Microphone)
      p.setVolume(v, Track.Source.ScreenShareAudio)
    }
  }

  /** Decide se o microfone transmite agora (mute, ensurdecido, push-to-talk). */
  const applyMic = async () => {
    const { room, micMuted, deafened, pttActive } = get()
    if (!room || room.state !== ConnectionState.Connected) return
    const ptt = useSettings.getState().settings.voice.pttEnabled
    const want = !micMuted && !deafened && (!ptt || pttActive)
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
    gate.enabled = !v.autoSensitivity
    gate.threshold = v.sensitivity
    if (track.getProcessor?.() !== gate) {
      try {
        await track.setProcessor(gate)
      } catch {
        gate = null // navegador sem suporte: segue sem porta de ruído
      }
    }
  }

  const handleMediaError = (e: unknown, what: string) => {
    const name = (e as { name?: string })?.name ?? ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError')
      toast.error(`Permissão negada para ${what}. Libere o acesso nas configurações do navegador/sistema e tente novamente.`)
    else if (name === 'NotFoundError' || name === 'OverconstrainedError')
      toast.error(`Dispositivo de ${what} não encontrado. Verifique se está conectado.`)
    else if (name === 'NotReadableError') toast.error(`O ${what} está em uso por outro aplicativo ou indisponível.`)
    else toast.error(`Falha ao acessar ${what}.`)
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
      .on(RoomEvent.MediaDevicesChanged, touch)
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!room.canPlaybackAudio) void room.startAudio().catch(() => undefined)
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (get().room !== room) return
        track_cleanup()
        if (userLeft || reason === DisconnectReason.CLIENT_INITIATED) return
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
        screenShareEncoding: { maxBitrate: 3_500_000, maxFramerate: s.screenFps },
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
      try {
        if (lp.isScreenShareEnabled) {
          await lp.setScreenShareEnabled(false)
        } else {
          await lp.setScreenShareEnabled(
            true,
            {
              audio: s.screenAudio,
              resolution: screenRes(s.screenQuality, s.screenFps),
              contentHint: 'detail',
              selfBrowserSurface: 'exclude',
              surfaceSwitching: 'include',
              systemAudio: s.screenAudio ? 'include' : 'exclude',
            },
            { screenShareEncoding: { maxBitrate: 3_500_000, maxFramerate: s.screenFps } },
          )
          if (s.screenAudio && !lp.getTrackPublication(Track.Source.ScreenShareAudio)) {
            toast.info(
              'Tela compartilhada sem áudio do sistema. No seletor, marque "Compartilhar áudio do sistema" (disponível ao compartilhar a tela inteira ou uma aba no Chrome/Edge no Windows).',
            )
          }
        }
      } catch (e) {
        const name = (e as { name?: string })?.name
        if (name === 'NotAllowedError' || name === 'AbortError') toast.info('Compartilhamento cancelado.')
        else handleMediaError(e, 'tela')
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
      if (gate) {
        gate.enabled = !v.autoSensitivity
        gate.threshold = v.sensitivity
      } else void installGate()
      void applyMic()
    },
  }
})
