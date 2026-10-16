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
// cargos (Fase 2)
const { data: rolesA } = await A.c.from('roles').select('*').eq('server_id', sid)
const modR = rolesA.find((r) => r.name === 'Moderador')
const { error: eSelf } = await A.c.rpc('set_member_role', { p_server: sid, p_user: A.id, p_role: modR.id, p_grant: true }); ok('dono aplica cargo em si mesmo', !eSelf, eSelf?.message)
const { error: eProm } = await B.c.rpc('set_member_role', { p_server: sid, p_user: B.id, p_role: modR.id, p_grant: true }); ok('membro comum NÃO se promove', !!eProm, eProm?.message)
const { data: newRole, error: eNew } = await A.c.rpc('create_role', { p_server: sid, p_name: 'Fundadores', p_color: '#ff0066', p_permissions: [], p_hoist: true, p_members: [B.id] }); ok('cria cargo já com membros', !!newRole && !eNew, eNew?.message)
const { data: memB } = await B.c.from('members').select('member_roles(role_id)').eq('server_id', sid).eq('user_id', B.id).single(); ok('B enxerga o cargo recebido', memB?.member_roles?.some((r) => r.role_id === newRole))
const { data: rolesNow } = await A.c.from('roles').select('id,is_default,position').eq('server_id', sid)
const ordered = rolesNow.filter((r) => !r.is_default).sort((a, b) => a.position - b.position).map((r) => r.id)
const { error: eOrd } = await A.c.rpc('reorder_roles', { p_server: sid, p_order: ordered }); ok('dono reordena cargos', !eOrd, eOrd?.message)
const { error: eOrd2 } = await B.c.rpc('reorder_roles', { p_server: sid, p_order: ordered }); ok('membro NÃO reordena cargos', !!eOrd2)
const { error: eBot } = await A.c.from('profiles').update({ is_bot: true }).eq('id', A.id); ok('is_bot não é auto-declarável', !!eBot, eBot?.message)// amizade e mensagens diretas (Fase 4)
const { data: fr, error: eFr } = await A.c.rpc('send_friend_request', { p_username: `e2e_bruno_${tag}` }); ok('A envia pedido de amizade', fr === 'sent' && !eFr, eFr?.message ?? fr)
const { error: eAcc } = await B.c.rpc('respond_friend_request', { p_requester: A.id, p_accept: true }); ok('B aceita o pedido', !eAcc, eAcc?.message)
const { data: dm, error: eDm } = await A.c.rpc('open_dm', { p_user: B.id }); ok('A abre DM com B', !!dm && !eDm, eDm?.message)
await A.c.rpc('send_message', { p_id: crypto.randomUUID(), p_channel: null, p_dm: dm, p_content: 'oi por DM', p_reply_to: null, p_attachments: [] })
const { data: unreadB } = await B.c.rpc('unread_summary'); ok('B vê 1 não lida na DM', unreadB?.some((u) => u.dm_id === dm && u.unread_count === 1))
await B.c.rpc('mark_read', { p_dm: dm })
const { data: unreadB2 } = await B.c.rpc('unread_summary'); ok('mark_read zera as não lidas', !unreadB2?.some((u) => u.dm_id === dm))
const { data: dmX } = await X.c.from('messages').select('id').eq('dm_id', dm); ok('X (de fora) NÃO lê a DM', (dmX ?? []).length === 0)
const { error: eDmX } = await X.c.rpc('send_message', { p_id: crypto.randomUUID(), p_channel: null, p_dm: dm, p_content: 'invasor', p_reply_to: null, p_attachments: [] }); ok('X NÃO escreve na DM', !!eDmX)

// castigo e moderação de voz
const { data: chansM } = await A.c.from('channels').select('*').eq('server_id', sid)
const voiceM = chansM.find((c) => c.kind === 'voice'), textM = chansM.find((c) => c.kind === 'text')
const { error: eTo } = await A.c.rpc('timeout_member', { p_server: sid, p_user: B.id, p_seconds: 60, p_reason: 'teste' }); ok('A castiga B', !eTo, eTo?.message)
const { error: eSendTo } = await B.c.rpc('send_message', { p_id: crypto.randomUUID(), p_channel: textM.id, p_dm: null, p_content: 'de castigo', p_reply_to: null, p_attachments: [] }); ok('B de castigo NÃO envia mensagem', !!eSendTo && /timed_out/.test(eSendTo.message), eSendTo?.message)
const { error: eDmTo } = await B.c.rpc('send_message', { p_id: crypto.randomUUID(), p_channel: null, p_dm: dm, p_content: 'dm ok', p_reply_to: null, p_attachments: [] }); ok('B de castigo ainda escreve em DM', !eDmTo, eDmTo?.message)
const { error: eToSelf } = await B.c.rpc('timeout_member', { p_server: sid, p_user: A.id, p_seconds: 60 }); ok('B NÃO castiga o dono', !!eToSelf)
await A.c.rpc('timeout_member', { p_server: sid, p_user: B.id, p_seconds: 0 })
const { error: eSendOk } = await B.c.rpc('send_message', { p_id: crypto.randomUUID(), p_channel: textM.id, p_dm: null, p_content: 'livre', p_reply_to: null, p_attachments: [] }); ok('castigo removido: B volta a escrever', !eSendOk, eSendOk?.message)
const call = (U, body) => U.c.functions.invoke('voice-moderate', { body }).then(async (r) => { if (!r.error) return { ok: true, data: r.data }; let b = {}; try { b = await r.error.context.json() } catch {} return { ok: false, status: r.error.context?.status, body: b } })
const vm1 = await call(A, { serverId: sid, targetId: B.id, action: 'mute', channelId: voiceM.id }); ok('voice-moderate: A silencia B (função publicada)', vm1.ok, JSON.stringify(vm1.body ?? vm1.data))
const { data: flagB } = await A.c.from('members').select('voice_muted').eq('server_id', sid).eq('user_id', B.id).single(); ok('estado "silenciado" gravado', flagB?.voice_muted === true)
const { data: tokB } = await B.c.functions.invoke('livekit-token', { body: { channelId: voiceM.id } }); const gB = tokB?.token && JSON.parse(Buffer.from(tokB.token.split('.')[1], 'base64url').toString()).video; ok('token de B silenciado NÃO permite publicar', gB && gB.canPublish === false, JSON.stringify(gB?.canPublishSources))
const vm2 = await call(B, { serverId: sid, targetId: A.id, action: 'mute', channelId: voiceM.id }); ok('B NÃO silencia o dono', !vm2.ok && vm2.status === 403, JSON.stringify(vm2.body))
const vm3 = await call(A, { serverId: sid, targetId: B.id, action: 'move', channelId: voiceM.id, destId: voiceM.id }); ok('voice-moderate: mover aceito', vm3.ok, JSON.stringify(vm3.body))
const vm4 = await call(A, { serverId: sid, targetId: B.id, action: 'unmute', channelId: voiceM.id }); ok('A remove o silêncio', vm4.ok, JSON.stringify(vm4.body))
const vm5 = await call(A, { serverId: sid, targetId: B.id, action: 'explodir' }); ok('ação inválida rejeitada', !vm5.ok && vm5.status === 400)

// bot de música (Fase 4)
const { error: eNoBot } = await A.c.rpc('music_add', { p_channel: voiceM.id, p_video: 'dQw4w9WgXcQ', p_title: 'x' }); ok('música com o bot desligado é negada', !!eNoBot && /bot_disabled/.test(eNoBot.message))
const { error: eBotB } = await B.c.rpc('set_music_bot', { p_server: sid, p_enabled: true }); ok('membro comum NÃO liga o bot', !!eBotB)
const { error: eBotA } = await A.c.rpc('set_music_bot', { p_server: sid, p_enabled: true }); ok('dono liga o Vibe Beats', !eBotA, eBotA?.message)
await A.c.rpc('set_music_channel', { p_server: sid, p_channel: textM.id })
const { data: botM } = await B.c.from('members').select('profile:profiles(username,is_bot,display_name)').eq('server_id', sid); ok('bot aparece como membro com is_bot', botM?.some((m) => m.profile?.is_bot && m.profile?.username === 'vibebeats'))
await B.c.rpc('music_add', { p_channel: voiceM.id, p_video: 'dQw4w9WgXcQ', p_title: 'Primeira' }); await A.c.rpc('music_add', { p_channel: voiceM.id, p_video: '9bZkp7q19f0', p_title: 'Segunda' })
const { data: sess } = await X.c.from('music_sessions').select('*').eq('channel_id', voiceM.id); ok('X (de fora) NÃO vê a sessão de música', (sess ?? []).length === 0)
const { data: sessB } = await B.c.from('music_sessions').select('*').eq('channel_id', voiceM.id).single(); const { data: qB } = await B.c.from('music_queue').select('title').eq('channel_id', voiceM.id); ok('B vê tocando + fila', sessB?.status === 'playing' && sessB?.video_id === 'dQw4w9WgXcQ' && qB?.length === 1)
await A.c.rpc('music_control', { p_channel: voiceM.id, p_action: 'skip', p_expect: 'dQw4w9WgXcQ' }); const { data: sessSkip } = await B.c.from('music_sessions').select('video_id').eq('channel_id', voiceM.id).single(); ok('pular avança para a segunda', sessSkip?.video_id === '9bZkp7q19f0')
const { data: botMsgs } = await B.c.from('messages').select('content, author_id').eq('channel_id', textM.id).eq('author_id', '00000000-0000-4000-8000-00000000b075'); ok('bot anuncia no canal de comandos', (botMsgs ?? []).length >= 2, `${botMsgs?.length} msgs`)
const { error: eKickBot } = await A.c.rpc('kick_member', { p_server: sid, p_user: '00000000-0000-4000-8000-00000000b075', p_reason: '' }); ok('bot NÃO pode ser expulso', !!eKickBot)
await A.c.rpc('music_control', { p_channel: voiceM.id, p_action: 'stop' })
await A.c.rpc('set_music_bot', { p_server: sid, p_enabled: false })// LiveKit token
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

