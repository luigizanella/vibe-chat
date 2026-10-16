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
} from 'livekit-client'
import { supabase } from '@/lib/supabase'
import { useSettings } from './settings'
import { toast } from './ui'
import { playSound } from '@/lib/sounds'
import { MicChain, captureConstraints, type MicChainStatus } from '@/lib/micProcessor'
import { acquireScreenStream, screenPreset, type ScreenAcquire } from '@/lib/screen'
import { reportMediaError, type MediaKind } from '@/lib/mediaErrors'
import { diag, isSafari, vozLog } from '@/lib/diag'

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
  /** O que está rodando na cadeia de áudio do microfone (null = sem processador). */
  micChain: MicChainStatus | null
  /** Silenciado/ensurdecido por um moderador do servidor (não dá para desfazer sozinho). */
  serverMuted: boolean
  serverDeafened: boolean
  setServerFlags: (muted: boolean, deafened: boolean) => void
  join: (t: VoiceTarget, watch?: string) => Promise<void>
  /** Quem você está assistindo (transmissão de tela); só essa é baixada. */
  /** O navegador bloqueou o áudio da chamada até um clique (Safari/iOS). */
  audioBlocked: boolean
  enableAudio: () => Promise<void>
  watching: string | null
  watch: (identity: string | null) => void
  leave: () => Promise<void>
  retry: () => Promise<void>
  toggleMic: () => Promise<void>
  toggleDeafen: () => Promise<void>
  toggleCamera: () => Promise<void>
  toggleScreen: (pending?: Promise<ScreenAcquire>) => Promise<void>
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

let gate: MicChain | null = null
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
    const w = get().watching
    const snap = snapshot(room)
    if (w && !snap.some((p) => p.identity === w && p.screenOn)) set({ watching: null })
    set((s) => ({
      participants: snap,
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
    gate ??= new MicChain()
    gate.configure({ mode: v.noiseMode, auto: v.autoSensitivity, sensitivity: v.sensitivity })
    gate.onMeter = (micLevel, micOpen, micThreshold) => set({ micLevel, micOpen, micThreshold })
    gate.onStatus = (micChain) => set({ micChain })
    if (track.getProcessor?.() !== gate) {
      try {
        await track.setProcessor(gate)
      } catch (e) {
        console.warn('processador de microfone indisponível', (e as Error).message)
        gate = null // navegador sem suporte: segue sem porta de ruído
        set({ micChain: null })
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
  /** Áudio e câmera sempre; transmissão de tela (e seu áudio) só da pessoa que você escolheu assistir. */
  const applySubscriptions = () => {
    const { room, watching } = get()
    if (!room) return
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        const isScreen = pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio
        const want = !isScreen || p.identity === watching
        if (want !== pub.isSubscribed) pub.setSubscribed(want)
      }
    }
  }

  const wire = (room: Room) => {
    const touch = () => sync()
    room
      .on(RoomEvent.ParticipantConnected, () => {
        playSound('join')
        applySubscriptions()
        sync()
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        playSound('leave')
        sync()
      })
      .on(RoomEvent.ActiveSpeakersChanged, () => sync(false))
      .on(RoomEvent.TrackMuted, touch)
      .on(RoomEvent.TrackUnmuted, touch)
      .on(RoomEvent.TrackPublished, (pub) => {
        if (pub.source === Track.Source.ScreenShare) playSound('streamOther')
        applySubscriptions()
        sync()
      })
      .on(RoomEvent.TrackUnpublished, (pub) => {
        if (pub.source === Track.Source.ScreenShare) playSound('streamStop')
        sync()
      })
      .on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.source === Track.Source.ScreenShare) playSound('streamStart')
        sync()
      })
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === Track.Source.ScreenShare) {
          toast.info('Compartilhamento de tela encerrado.')
          playSound('streamStop')
        }
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
      .on(RoomEvent.Reconnecting, () => {
        vozLog('reconectando (LiveKit)')
        set({ status: 'reconnecting' })
      })
      .on(RoomEvent.Reconnected, () => {
        vozLog('reconectado')
        set({ status: 'connected', error: null })
        sync()
      })
      .on(RoomEvent.MediaDevicesChanged, () => void checkDevices(room))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!room.canPlaybackAudio) void room.startAudio().catch(() => undefined)
        set({ audioBlocked: !room.canPlaybackAudio })
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (get().room !== room) return
        const reasonName = reason === undefined ? 'desconhecido' : (DisconnectReason[reason] ?? String(reason))
        diag.lastDisconnect = `${reasonName} · ${new Date().toLocaleTimeString('pt-BR')}`
        vozLog('desconectado', reasonName)
        track_cleanup()
        stopPing()
        if (userLeft || reason === DisconnectReason.CLIENT_INITIATED) return
        if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
          // a mesma conta entrou em outro lugar (outra aba, navegador ou o app): reconectar aqui derrubaria o outro em loop
          set({ status: 'failed', error: 'Sua conta entrou nesta chamada em outro lugar (outra aba, navegador ou o app). Feche o outro e toque em “Tentar agora” para voltar para cá.', room: null, participants: [] })
          return
        }
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
        ...captureConstraints(s.noiseMode, s.echoCancellation, s.autoGainControl),
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
    await room.connect(url, token, { autoSubscribe: false })
    applySubscriptions()
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
    micChain: null,
    watching: null,
    audioBlocked: false,
    enableAudio: async () => {
      try {
        await get().room?.startAudio()
      } catch (e) {
        vozLog('startAudio falhou', (e as Error).message)
      }
      set({ audioBlocked: !get().room?.canPlaybackAudio })
    },
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

    watch: (identity) => {
      set({ watching: identity })
      applySubscriptions()
      sync()
    },

    join: async (target, watch) => {
      if (get().channelId === target.id && get().status !== 'failed') return
      if (get().room) await get().leave()
      userLeft = false
      retries = 0
      const s = useSettings.getState().settings.voice
      set({ status: 'connecting', error: null, target, channelId: target.id, micMuted: s.joinMuted || s.pttEnabled, deafened: false, focus: null, watching: watch ?? null })
      try {
        vozLog('entrando', target.name)
        const room = await connectRoom(target)
        set({ status: 'connected' })
        sync() // mostra todos os participantes na hora, antes de qualquer outra etapa (áudio, microfone)
        startPing()
        playSound('join')
        // autoplay (Safari/iOS): se o navegador bloquear o áudio, a tela mostra o botão "Ativar áudio"
        void room.startAudio().then(() => set({ audioBlocked: !room.canPlaybackAudio }), () => set({ audioBlocked: true }))
        vozLog('conectado', { participantes: room.remoteParticipants.size + 1 })
        await applyMic()
        applyVolumes()
        sync()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha ao conectar.'
        diag.lastError = msg
        vozLog('falha ao conectar', msg)
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
      set({ room: null, channelId: null, target: null, status: 'idle', error: null, participants: [], camOn: false, screenOn: false, focus: null, pttActive: false, watching: null })
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
        sync()
        startPing()
        void room.startAudio().then(() => set({ audioBlocked: !room.canPlaybackAudio }), () => set({ audioBlocked: true }))
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

    toggleScreen: async (pending) => {
      const room = get().room
      if (!room) return
      if (!navigator.mediaDevices?.getDisplayMedia) {
        toast.error('Seu navegador/sistema não suporta compartilhamento de tela.')
        return
      }
      const lp = room.localParticipant
      const s = useSettings.getState().settings.voice
      if (get().serverMuted && !lp.isScreenShareEnabled) return void toast.error('Você foi silenciado por um moderador e não pode compartilhar a tela agora.')
      if (lp.isScreenShareEnabled) {
        // encerra de verdade a captura (o aviso "compartilhando" do navegador some)
        for (const src of [Track.Source.ScreenShare, Track.Source.ScreenShareAudio]) lp.getTrackPublication(src)?.track?.mediaStreamTrack.stop()
        try {
          await lp.setScreenShareEnabled(false)
        } catch (e) {
          vozLog('erro ao parar tela', (e as Error).message)
        }
        sync()
        return
      }
      const p = screenPreset(s.screenQuality, s.screenFps)
      let stream: MediaStream | undefined
      try {
        // se o clique já pediu a captura (pending), usa; senão pede agora (ainda no gesto)
        const got = await (pending ?? acquireScreenStream(s.screenQuality, s.screenFps, s.screenAudio))
        stream = got.stream
        const vt = stream.getVideoTracks()[0]
        if (!vt) throw Object.assign(new Error('sem vídeo'), { name: 'NotFoundError' })
        vt.contentHint = p.fps === 60 ? 'motion' : 'detail'
        vozLog('tela capturada', { ...vt.getSettings(), audio: stream.getAudioTracks().length })
        vt.addEventListener('ended', () => void (useVoice.getState().screenOn && useVoice.getState().toggleScreen()), { once: true })
        await lp.publishTrack(vt, {
          source: Track.Source.ScreenShare,
          name: 'screen',
          simulcast: false,
          screenShareEncoding: { maxBitrate: p.maxBitrate, maxFramerate: p.fps },
        })
        const at = stream.getAudioTracks()[0]
        if (at && s.screenAudio) await lp.publishTrack(at, { source: Track.Source.ScreenShareAudio, name: 'screen-audio' })
        else if (s.screenAudio) toast.info(isSafari() ? 'O Safari não compartilha o áudio do sistema; só a imagem foi enviada.' : 'Tela compartilhada sem áudio do sistema. No seletor, marque "Compartilhar áudio" (tela inteira ou aba no Chrome/Edge).')
      } catch (e) {
        stream?.getTracks().forEach((t) => t.stop())
        const ms = (e as { ms?: number })?.ms
        const err = e as { name?: string; message?: string }
        diag.screenError = `${err.name ?? 'Erro'}: ${err.message ?? ''}${ms !== undefined ? ` (após ${Math.round(ms)} ms)` : ''}`
        vozLog('falha ao compartilhar tela', diag.screenError)
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
      if (!gate) {
        void installGate().then(() => applyMic())
        return
      }
      const modeChanged = gate.mode !== v.noiseMode
      gate.configure({ mode: v.noiseMode, auto: v.autoSensitivity, sensitivity: v.sensitivity })
      if (modeChanged) {
        // o modo muda a captura (supressão do navegador) e a cadeia: reabre a faixa com as novas opções
        const track = get().room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
        if (track instanceof LocalAudioTrack) {
          void track.restartTrack(captureConstraints(v.noiseMode, v.echoCancellation, v.autoGainControl)).catch((e) => handleMediaError(e, 'microfone'))
        }
      }
      void applyMic()
    },
  }
})

/** Diagnóstico: confirma que a faixa PUBLICADA na LiveKit é a que sai da cadeia de áudio local. */
export function diagnoseMic(): { chain: MicChainStatus | null; published: boolean; muted: boolean } | null {
  const room = useVoice.getState().room
  const track = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
  if (!(track instanceof LocalAudioTrack)) return null
  const published = !!gate && track.getProcessor?.() === gate && !!gate.processedTrack && track.mediaStreamTrack === gate.processedTrack
  return { chain: gate?.status ?? null, published, muted: track.isMuted }
}
