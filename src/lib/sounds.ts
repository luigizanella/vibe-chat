import { useSettings } from '@/store/settings'

export type SoundName = 'message' | 'mention' | 'join' | 'leave' | 'mute' | 'unmute' | 'deafen' | 'undeafen' | 'error'

let ctx: AudioContext | null = null

// [frequência Hz, duração s, atraso s]
const PATTERNS: Record<SoundName, [number, number, number][]> = {
  message: [[660, 0.08, 0], [880, 0.1, 0.08]],
  mention: [[784, 0.09, 0], [988, 0.09, 0.09], [1175, 0.14, 0.18]],
  join: [[523, 0.08, 0], [784, 0.14, 0.08]],
  leave: [[784, 0.08, 0], [523, 0.14, 0.08]],
  mute: [[440, 0.1, 0]],
  unmute: [[660, 0.1, 0]],
  deafen: [[440, 0.08, 0], [330, 0.1, 0.08]],
  undeafen: [[330, 0.08, 0], [440, 0.1, 0.08]],
  error: [[220, 0.18, 0]],
}

/** Sons sintetizados via WebAudio (sem arquivos de áudio protegidos). */
export function playSound(name: SoundName): void {
  const { sounds } = useSettings.getState().settings
  if (!sounds.enabled) return
  if ((name === 'message' && !sounds.message) || (name === 'mention' && !sounds.mention)) return
  if ((name === 'join' || name === 'leave') && !sounds.call) return
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    for (const [freq, dur, delay] of PATTERNS[name]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const vol = 0.15 * sounds.volume
      gain.gain.setValueAtTime(0.0001, now + delay)
      gain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), now + delay + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + delay)
      osc.stop(now + delay + dur + 0.02)
    }
  } catch {
    /* áudio indisponível: ignorar */
  }
}
