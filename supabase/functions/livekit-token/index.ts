// Edge Function: emite tokens de acesso do LiveKit com permissões mínimas.
//
// Fluxo: o cliente envia { channelId } com o JWT do Supabase. A função chama a RPC
// public.voice_access COM O JWT DO USUÁRIO (RLS/permissões validadas no banco) e só
// então assina o token. LIVEKIT_API_SECRET existe apenas aqui (secret da função).
//
// Secrets necessários: LIVEKIT_URL (wss://...), LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
// SUPABASE_URL e SUPABASE_ANON_KEY são injetados automaticamente.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { AccessToken, TrackSource } from 'npm:livekit-server-sdk@2.19.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_TTL_SECONDS = 60 * 60

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const livekitUrl = Deno.env.get('LIVEKIT_URL')
  const apiKey = Deno.env.get('LIVEKIT_API_KEY')
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET')
  if (!livekitUrl || !apiKey || !apiSecret) {
    return json({ error: 'livekit_not_configured', message: 'LIVEKIT_URL/API_KEY/API_SECRET não configurados.' }, 503)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthenticated' }, 401)

  let channelId: unknown
  try {
    ;({ channelId } = await req.json())
  } catch {
    return json({ error: 'invalid_input' }, 400)
  }
  if (typeof channelId !== 'string' || !UUID.test(channelId)) return json({ error: 'invalid_input' }, 400)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return json({ error: 'unauthenticated' }, 401)

  const { data, error } = await supabase.rpc('voice_access', { p_channel: channelId })
  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('rate_limited')) return json({ error: 'rate_limited' }, 429)
    if (msg.includes('forbidden')) return json({ error: 'forbidden' }, 403)
    console.error('voice_access error', error.code) // sem dados sensíveis
    return json({ error: 'internal' }, 500)
  }
  const access = Array.isArray(data) ? data[0] : data
  if (!access?.can_connect) return json({ error: 'forbidden' }, 403)

  const sources: TrackSource[] = []
  if (access.can_speak) sources.push(TrackSource.MICROPHONE)
  if (access.can_video) sources.push(TrackSource.CAMERA)
  if (access.can_screen) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO)

  const at = new AccessToken(apiKey, apiSecret, {
    identity: userData.user.id,
    name: access.display_name ?? 'Usuário',
    ttl: TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({ avatar: access.avatar_path ?? null }),
  })
  at.addGrant({
    roomJoin: true,
    room: `vc_${channelId}`,
    canSubscribe: true,
    canPublish: sources.length > 0,
    canPublishSources: sources,
    canPublishData: true,
  })

  return json({ token: await at.toJwt(), url: livekitUrl, room: `vc_${channelId}`, ttl: TOKEN_TTL_SECONDS })
})
