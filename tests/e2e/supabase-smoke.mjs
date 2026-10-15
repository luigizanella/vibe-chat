// Teste de fumaça REAL contra o projeto Supabase do .env (cria e apaga contas de teste). Uso: npm run test:e2e
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const app = Object.fromEntries(readFileSync(process.cwd() + '/.env', 'utf8').split(/\r?\n/).filter(l => /^VITE_\w+=.+/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))
const mk = () => createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const ok = (n, c, extra = '') => console.log((c ? 'OK   ' : 'FAIL ') + n + (extra ? ' — ' + extra : ''))
const tag = Date.now().toString(36)
const mkUser = async (name) => {
  const c = mk()
  const email = `e2e_${name}_${tag}@example.com`
  const { data: av } = await c.rpc('username_available', { p_username: `e2e_${name}_${tag}` })
  const { data, error } = await c.auth.signUp({ email, password: 'Teste-12345!', options: { data: { username: `e2e_${name}_${tag}`, display_name: name } } })
  return { c, email, id: data.user?.id, session: data.session, error, av }
}
const A = await mkUser('alice'); const B = await mkUser('bruno'); const X = await mkUser('xavier')
ok('username_available (anon) antes do cadastro', A.av === true)
ok('cadastro com sessão imediata (sem confirmação de e-mail)', !!A.session && !!B.session, A.error?.message)
const { data: prof } = await A.c.from('profiles').select('username,display_name').eq('id', A.id).single()
ok('perfil criado por trigger', prof?.display_name === 'alice')
const { data: sid, error: e1 } = await A.c.rpc('create_server', { p_name: 'E2E ' + tag }); ok('create_server', !!sid, e1?.message)
const { data: chans } = await A.c.from('channels').select('*').eq('server_id', sid)
const text = chans.find(c => c.kind === 'text'), voice = chans.find(c => c.kind === 'voice')
const { data: code } = await A.c.rpc('create_invite', { p_server: sid, p_expires_seconds: 3600, p_max_uses: null })
const { error: e2 } = await B.c.rpc('join_server', { p_code: code }); ok('B entra por convite', !e2, e2?.message)
const e3x = await A.c.rpc('send_message', { p_id: crypto.randomUUID(), p_channel: text.id, p_dm: null, p_content: 'olá do e2e', p_reply_to: null, p_attachments: [] }); const m1 = { id: e3x.data?.id }; const e3 = e3x.error; ok('A envia mensagem', !e3, e3?.message)
const { data: reply1 } = await B.c.rpc('send_message', { p_id: crypto.randomUUID(), p_channel: text.id, p_dm: null, p_content: 'resposta', p_reply_to: m1.id, p_attachments: [] });
const SEL = '*, author:profiles!author_id(id,username,display_name,avatar_path), attachments(*), reactions(*), reply:reply_to_id(id,content,author_id)'
const { data: withReply, error: eSel } = await B.c.from('messages').select(SEL).eq('channel_id', text.id).order('created_at'); ok('select com embeds (autor, anexos, reações, resposta)', !eSel && withReply?.some(m => m.reply && !Array.isArray(m.reply) && m.reply.id === m1.id && m.author?.username), eSel?.message)
const { data: seenB } = await B.c.from('messages').select('content').eq('channel_id', text.id); ok('B lê as mensagens', seenB?.length >= 1)
const { data: seenX } = await X.c.from('messages').select('content').eq('channel_id', text.id); ok('X (de fora) NÃO lê mensagens', (seenX ?? []).length === 0)
const { error: e4 } = await X.c.rpc('send_message', { p_id: crypto.randomUUID(), p_channel: text.id, p_dm: null, p_content: 'invasor', p_reply_to: null, p_attachments: [] }); ok('X NÃO envia mensagem', !!e4, e4?.message)
const { error: e5 } = await X.c.from('messages').insert({ channel_id: text.id, author_id: X.id, content: 'x' }); ok('INSERT direto negado', !!e5, e5?.message)
const { data: srvX } = await X.c.from('servers').select('id').eq('id', sid); ok('X NÃO vê o servidor', (srvX ?? []).length === 0)
const { error: e6 } = await B.c.rpc('create_channel', { p_server: sid, p_name: 'x', p_kind: 'text', p_category: null, p_private: false }); ok('B (membro) NÃO cria canal', !!e6)
// realtime privado: B recebe broadcast em chan:<id>, X é negado
const got = await new Promise((res) => {
  const ch = B.c.channel(`chan:${text.id}`, { config: { private: true } })
  const t = setTimeout(() => res('timeout'), 8000)
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => { clearTimeout(t); res('pg:' + p.new.content) })
  ch.subscribe(async (s) => { if (s === 'SUBSCRIBED') { await new Promise(r => setTimeout(r, 1500)); await A.c.rpc('send_message', { p_id: crypto.randomUUID(), p_channel: text.id, p_dm: null, p_content: 'tempo-real', p_reply_to: null, p_attachments: [] }) } if (s === 'CHANNEL_ERROR') { clearTimeout(t); res('channel_error') } })
})
ok('Realtime (postgres_changes) entrega mensagem a B', got === 'pg:tempo-real', got)
const xr = await new Promise((res) => { const ch = X.c.channel(`chan:${text.id}`, { config: { private: true } }); const t = setTimeout(() => res('timeout'), 6000); ch.subscribe((s) => { if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { clearTimeout(t); res(s) } }) })
ok('Realtime privado NEGA canal a X', xr !== 'SUBSCRIBED', xr)
// LiveKit token
for (const [n, U] of [['A', A], ['B', B], ['X', X]]) {
  const { data, error } = await U.c.functions.invoke('livekit-token', { body: { channelId: voice.id } })
  let body = data
  if (error) { try { body = await error.context.json() } catch { body = { error: error.message } } }
  const tokOk = !!body?.token
  if (n === 'X') ok('token LiveKit NEGADO a X', !tokOk, JSON.stringify(body)); else {
    ok(`token LiveKit emitido para ${n}`, tokOk, tokOk ? body.url : JSON.stringify(body))
    if (tokOk) { const p = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString()); ok(`  grants ${n}`, p.video?.room === 'vc_' + voice.id && p.video?.canPublish, JSON.stringify({ room: p.video.room, src: p.video.canPublishSources, exp: p.exp - p.nbf })) }
  }
}
const { error: ea } = await A.c.functions.invoke('livekit-token', { body: { channelId: 'nao-e-uuid' } }); ok('token com id inválido rejeitado', !!ea)
const noAuth = await fetch(app.VITE_SUPABASE_URL + '/functions/v1/livekit-token', { method: 'POST', headers: { apikey: app.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: voice.id }) }); ok('função sem login rejeitada', noAuth.status === 401, String(noAuth.status))
// limpeza: exclui contas de teste pela própria função delete-account
for (const U of [A, B, X]) { const { error } = await U.c.functions.invoke('delete-account', { body: { confirm: 'EXCLUIR' } }); ok('delete-account', !error, error?.message) }
process.exit(0)

