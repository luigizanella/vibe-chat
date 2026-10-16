// Edge Function: moderação de voz (silenciar, ensurdecer, desconectar, mover).
//
// A AUTORIZAÇÃO acontece no banco (RPC public.voice_moderate, executada com o JWT do usuário:
// permissão do cargo + hierarquia). Só depois a função aplica o efeito no servidor LiveKit com o
// API Secret (que existe apenas aqui). Silenciar/ensurdecer revogam permissões de publicar/assinar
// em tempo real; desconectar/mover removem a pessoa da sala (e o banco avisa o cliente dela para
// entrar na sala de destino).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { RoomServiceClient, TrackSource } from 'npm:livekit-server-sdk@2.19.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = ['mute', 'unmute', 'deafen', 'undeafen', 'disconnect', 'move']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('LIVEKIT_URL')
  const apiKey = Deno.env.get('LIVEKIT_API_KEY')
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET')
  if (!url || !apiKey || !apiSecret) return json({ error: 'livekit_not_configured' }, 503)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthenticated' }, 401)

  let body: { serverId?: string; targetId?: string; action?: string; channelId?: string | null; destId?: string | null }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_input' }, 400)
  }
  const { serverId, targetId, action, channelId = null, destId = null } = body
  if (
    typeof serverId !== 'string' || !UUID.test(serverId) || typeof targetId !== 'string' || !UUID.test(targetId) ||
    typeof action !== 'string' || !ACTIONS.includes(action) ||
    (channelId !== null && (typeof channelId !== 'string' || !UUID.test(channelId))) ||
    (destId !== null && (typeof destId !== 'string' || !UUID.test(destId)))
  ) return json({ error: 'invalid_input' }, 400)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return json({ error: 'unauthenticated' }, 401)

  const { data, error } = await supabase.rpc('voice_moderate', {
    p_server: serverId, p_target: targetId, p_action: action, p_channel: channelId, p_dest: destId,
  })
  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('rate_limited')) return json({ error: 'rate_limited' }, 429)
    if (msg.includes('forbidden')) return json({ error: 'forbidden' }, 403)
    if (msg.includes('invalid_input')) return json({ error: 'invalid_input' }, 400)
    console.error('voice_moderate error', error.code)
    return json({ error: 'internal' }, 500)
  }

  // Aplica no LiveKit (melhor esforço: o alvo pode já ter saído da sala)
  const host = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
  const lk = new RoomServiceClient(host, apiKey, apiSecret)
  const room = channelId ? `vc_${channelId}` : null
  let applied = false
  try {
    if (room) {
      if (action === 'disconnect' || action === 'move') {
        await lk.removeParticipant(room, targetId)
      } else {
        const sources: TrackSource[] = []
        if (data.can_speak) sources.push(TrackSource.MICROPHONE)
        if (data.can_video) sources.push(TrackSource.CAMERA)
        if (data.can_screen) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO)
        await lk.updateParticipant(room, targetId, undefined, {
          canSubscribe: !!data.can_listen,
          canPublish: sources.length > 0,
          canPublishSources: sources,
          canPublishData: true,
        })
      }
      applied = true
    }
  } catch (e) {
    // participante ausente da sala não é erro: o estado já foi gravado e vale no próximo token
    console.warn('livekit apply skipped', (e as Error).message?.slice(0, 120))
  }
  return json({ ok: true, applied })
})
