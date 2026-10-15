// Edge Function: exclusão definitiva da própria conta.
// Usa service_role (disponível apenas aqui, no servidor) para:
//  1) transferir/apagar servidores do usuário (public.prepare_account_deletion),
//  2) apagar avatar/banner do Storage,
//  3) apagar o usuário no Supabase Auth (cascata remove o perfil e dados associados;
//     mensagens permanecem sem autor).
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthenticated' }, 401)

  let body: { confirm?: string } = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_input' }, 400)
  }
  if (body.confirm !== 'EXCLUIR') return json({ error: 'confirmation_required' }, 400)

  const url = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) return json({ error: 'unauthenticated' }, 401)
  const uid = data.user.id

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const prep = await admin.rpc('prepare_account_deletion', { p_user: uid })
  if (prep.error) {
    console.error('prepare_account_deletion failed', prep.error.code)
    return json({ error: 'internal' }, 500)
  }

  for (const folder of ['avatars', 'banners']) {
    const { data: files } = await admin.storage.from('public-media').list(`${folder}/${uid}`)
    if (files?.length) await admin.storage.from('public-media').remove(files.map((f) => `${folder}/${uid}/${f.name}`))
  }

  const del = await admin.auth.admin.deleteUser(uid)
  if (del.error) {
    console.error('deleteUser failed', del.error.status)
    return json({ error: 'internal' }, 500)
  }
  return json({ ok: true })
})
