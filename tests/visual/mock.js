/**
 * SOMENTE PARA VERIFICAÇÃO VISUAL LOCAL (nunca entra no build de produção).
 * Intercepta as chamadas ao Supabase local inexistente (127.0.0.1:54321) e devolve fixtures
 * para permitir inspecionar layout/CSS/responsividade das telas autenticadas sem um backend.
 * Uso: npm run dev:visual  →  http://localhost:5174
 */
;(() => {
  const BASE = 'http://127.0.0.1:54321'
  const ME = '11111111-1111-4111-8111-111111111111'
  const ANA = '22222222-2222-4222-8222-222222222222'
  const BRU = '33333333-3333-4333-8333-333333333333'
  const SRV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const CAT1 = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1'
  const CAT2 = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2'
  const GERAL = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1'
  const OFF = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
  const VOZ = 'b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3'
  const R_DEF = 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0'
  const R_MOD = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'
  const DM = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1'
  const now = Date.now()
  const ago = (m) => new Date(now - m * 60000).toISOString()
  const prof = (id, username, display_name, extra = {}) => ({
    id, username, display_name, avatar_path: null, banner_path: null, banner_color: null, bio: '', custom_status: '',
    status_pref: 'online', onboarded: true, disabled_at: null, created_at: ago(60 * 24 * 30), ...extra,
  })
  const BOT = '44444444-4444-4444-8444-444444444444'
  const P = { [BOT]: prof(BOT, 'vibebeats', 'Vibe Beats', { is_bot: true, custom_status: '/tocar | /ajuda' }), [ME]: prof(ME, 'luigi', 'Luigi'), [ANA]: prof(ANA, 'ana', 'Ana Souza', { custom_status: 'Jogando 🎮' }), [BRU]: prof(BRU, 'bruno', 'Bruno') }
  const mini = (id) => ({ id, username: P[id].username, display_name: P[id].display_name, avatar_path: null })
  const msg = (n, author, content, mins, extra = {}) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, channel_id: GERAL, dm_id: null, author_id: author, content,
    reply_to_id: null, mention_user_ids: [], mention_role_ids: [], mention_everyone: false, edited_at: null, pinned_at: null,
    created_at: ago(mins), author: mini(author), attachments: [], reactions: [], reply: null, ...extra,
  })
  const messages = [
    msg(1, ANA, 'Bom dia, pessoal! Alguém topa jogar hoje à noite?', 240),
    msg(2, ANA, 'Podemos usar o canal de voz e compartilhar a tela 😄', 239),
    msg(3, BRU, 'Eu topo! **Que horas?**', 200, { reactions: [{ message_id: 'x', user_id: ANA, emoji: '👍' }, { message_id: 'x', user_id: ME, emoji: '👍' }] }),
    msg(4, ME, `Também! <@${ANA}> marca aí o horário. Segue um bloco de código:\n\`\`\`js\nconsole.log('olá')\n\`\`\``, 30, { mention_user_ids: [ANA] }),
    msg(5, ANA, 'Às 21h está bom? Veja https://example.com/jogo', 28, { reply_to_id: msg(4, ME, '', 0).id, reply: { id: msg(4, ME, '', 0).id, content: 'Também!', author_id: ME } }),
    msg(6, BRU, `Fechado, <@${ME}> 🔥`, 5, { mention_user_ids: [ME], edited_at: ago(4) }),
  ]
  const roles = [
    { id: R_DEF, server_id: SRV, name: 'Membro', color: '#99aab5', position: 0, permissions: ['send_messages', 'attach_files', 'add_reactions', 'create_invite', 'connect_voice', 'speak', 'video', 'screen_share'], is_default: true, hoist: false },
    { id: R_MOD, server_id: SRV, name: 'Moderador', color: '#3ba55d', position: 50, permissions: ['kick_members', 'ban_members', 'manage_messages'], is_default: false, hoist: true },
    { id: 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', server_id: SRV, name: 'Vibe Founder', color: '#e91e63', position: 80, permissions: ['manage_roles'], is_default: false, hoist: true },
  ]
  const members = [
    { server_id: SRV, user_id: ME, nickname: null, joined_at: ago(9999), profile: P[ME], member_roles: [{ role_id: 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2' }] },
    { server_id: SRV, user_id: ANA, nickname: null, joined_at: ago(9000), profile: P[ANA], member_roles: [{ role_id: R_MOD }] },
    { server_id: SRV, user_id: BRU, nickname: null, joined_at: ago(8000), timeout_until: new Date(now + 600000).toISOString(), voice_muted: true, voice_deafened: false, profile: P[BRU], member_roles: [] },
    { server_id: SRV, user_id: BOT, nickname: null, joined_at: ago(7000), profile: P[BOT], member_roles: [{ role_id: 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2' }] },
  ]
  const T = {
    profiles: Object.values(P),
    servers: [{ id: SRV, name: 'Amigos do Jogo', icon_path: null, owner_id: ME, created_at: ago(9999) }],
    roles, members,
    categories: [{ id: CAT1, server_id: SRV, name: 'Canais de texto', position: 0 }, { id: CAT2, server_id: SRV, name: 'Canais de voz', position: 1 }],
    channels: [
      { id: GERAL, server_id: SRV, category_id: CAT1, name: 'geral', kind: 'text', topic: 'Conversa geral do grupo', position: 0, is_private: false },
      { id: OFF, server_id: SRV, category_id: CAT1, name: 'off-topic', kind: 'text', topic: '', position: 1, is_private: false },
      { id: VOZ, server_id: SRV, category_id: CAT2, name: 'Voz geral', kind: 'voice', topic: '', position: 0, is_private: false },
    ],
    messages, music_sessions: [], music_queue: [],
    friendships: [{ requester_id: ME, addressee_id: ANA, status: 'accepted', created_at: ago(5000) }, { requester_id: BRU, addressee_id: ME, status: 'pending', created_at: ago(100) }],
    blocks: [], notification_prefs: [],
    dm_conversations: [{ id: DM, is_group: false, name: null, pair_key: 'x', created_at: ago(500), last_message_at: ago(10),
      dm_participants: [{ user_id: ME, profile: mini(ME) }, { user_id: ANA, profile: mini(ANA) }] }],
    user_prefs: [{ user_id: ME, settings: {}, dm_policy: 'everyone', friend_requests: 'everyone' }],
  }
  const RPC = {
    unread_summary: () => [{ channel_id: OFF, dm_id: null, unread_count: 3, mention_count: 1 }, { channel_id: null, dm_id: DM, unread_count: 2, mention_count: 0 }],
    can_send_in_channel: () => true,
    mark_read: () => null,
  }

  // sessão fictícia para o supabase-js
  const session = {
    access_token: 'a.b.c', refresh_token: 'r', token_type: 'bearer', expires_in: 36000, expires_at: Math.floor(now / 1000) + 36000,
    user: { id: ME, aud: 'authenticated', email: 'luigi@example.test', app_metadata: {}, user_metadata: {}, created_at: ago(9999) },
  }
  localStorage.setItem('vibe.auth', JSON.stringify(session))

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/*' } })
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href)
    if (!url.href.startsWith(BASE)) return realFetch(input, init)
    const path = url.pathname
    const accept = (init && init.headers && (init.headers.Accept || init.headers.accept)) || ''
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop()
      return json(RPC[fn] ? RPC[fn]() : null)
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.split('/').pop()
      let rows = (T[table] || []).slice()
      for (const [k, v] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(k)) continue
        if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3))
        if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(','); rows = rows.filter((r) => set.includes(String(r[k]))) }
        if (v.startsWith('lt.')) rows = rows.filter((r) => r[k] < v.slice(3))
        if (v === 'not.is.null') rows = rows.filter((r) => r[k] != null)
      }
      if (accept.includes('vnd.pgrst.object')) return json(rows[0] ?? null, rows[0] ? 200 : 406)
      return json(rows)
    }
    if (path.startsWith('/functions/v1/')) return json({ error: 'livekit_not_configured' }, 503)
    if (path.startsWith('/auth/v1/')) return json({ ...session, user: session.user })
    return json({ error: 'mock: not found' }, 404)
  }

  // Realtime: WebSocket que nunca conecta (sem tempo real nesta verificação visual)
  window.WebSocket = class {
    constructor() { this.readyState = 0; setTimeout(() => this.onerror && this.onerror(new Event('error')), 50) }
    send() {} close() { this.readyState = 3 }
    addEventListener() {} removeEventListener() {}
  }
})()
