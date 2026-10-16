import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, errorOf, type Db } from './harness'

let db: Db
let owner: string, member: string, outsider: string, bot: string
let server: string, text: string, voice: string, privVoice: string, commands: string

const V1 = 'dQw4w9WgXcQ'
const V2 = '9bZkp7q19f0'
const V3 = 'kJQP7kiw5Fk'

const add = (u: string, v: string, t = 'Faixa', ch = voice) => db.as(u, `select public.music_add($1,$2,$3)`, [ch, v, t])
const ctl = (u: string, a: string, expect: string | null = null, ch = voice) => db.as(u, `select public.music_control($1,$2,$3)`, [ch, a, expect])
const session = async (ch = voice) => (await db.admin<{ status: string; video_id: string | null; title: string | null; prev_video_id: string | null; paused_ms: number }>(`select status, video_id, title, prev_video_id, paused_ms from music_sessions where channel_id=$1`, [ch]))[0]
const queue = async (ch = voice) => (await db.admin<{ video_id: string; id: string }>(`select video_id, id from music_queue where channel_id=$1 order by ord`, [ch]))
const botMsgs = async () => (await db.admin<{ content: string }>(`select content from messages where channel_id=$1 and author_id=$2 order by created_at, id`, [commands, bot]))

beforeAll(async () => {
  db = await createDb()
  ;[owner, member, outsider] = await Promise.all(['dono', 'membro', 'fora'].map((n) => db.createUser(n)))
  bot = (await db.admin<{ id: string }>(`select id from profiles where username='vibebeats'`))[0].id
  server = (await db.as<{ create_server: string }>(owner, `select public.create_server('Música')`))[0].create_server
  text = (await db.admin<{ id: string }>(`select id from channels where server_id=$1 and kind='text'`, [server]))[0].id
  voice = (await db.admin<{ id: string }>(`select id from channels where server_id=$1 and kind='voice'`, [server]))[0].id
  privVoice = (await db.as<{ create_channel: string }>(owner, `select public.create_channel($1,'Secreta','voice',null,true)`, [server]))[0].create_channel
  commands = (await db.as<{ create_channel: string }>(owner, `select public.create_channel($1,'comandos','text',null,false)`, [server]))[0].create_channel
  const code = (await db.as<{ create_invite: string }>(owner, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
  await db.as(member, `select public.join_server($1)`, [code])
})

describe('bot "Vibe Beats"', () => {
  it('existe como perfil bot, sem possibilidade de login, e sem permissão de ser auto-editado', async () => {
    const p = (await db.admin<{ is_bot: boolean; display_name: string; avatar_path: string }>(`select is_bot, display_name, avatar_path from profiles where id=$1`, [bot]))[0]
    expect(p).toMatchObject({ is_bot: true, display_name: 'Vibe Beats' })
    expect((await db.admin<{ encrypted_password: string | null }[]>(`select 1 from auth.users where id=$1`, [bot])).length).toBe(1)
  })

  it('com o bot desligado, ninguém usa os comandos', async () => {
    expect(await errorOf(add(owner, V1))).toMatch(/bot_disabled/)
  })

  it('só quem gerencia o servidor liga/desliga o bot e define o canal de comandos', async () => {
    expect(await errorOf(db.as(member, `select public.set_music_bot($1,true)`, [server]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(member, `select public.set_music_channel($1,$2)`, [server, commands]))).toMatch(/forbidden/)
    await db.as(owner, `select public.set_music_bot($1,true)`, [server])
    await db.as(owner, `select public.set_music_channel($1,$2)`, [server, commands])
    expect((await db.as(member, `select * from members where server_id=$1 and user_id=$2`, [server, bot])).length).toBe(1)
    expect(await errorOf(db.as(owner, `select public.set_music_channel($1,$2)`, [server, voice]))).toMatch(/invalid_input/)
  })

  it('o bot não pode ser expulso, banido, castigado nem silenciado por moderadores/dono', async () => {
    for (const q of [`select public.kick_member($1,$2,'')`, `select public.ban_member($1,$2,'')`, `select public.timeout_member($1,$2,60)`]) {
      expect(await errorOf(db.as(owner, q, [server, bot])), q).toMatch(/forbidden/)
    }
  })
})

describe('fila e reprodução', () => {
  it('primeira música toca na hora; as seguintes entram na fila; o bot anuncia no canal de comandos', async () => {
    await add(member, V1, 'Primeira')
    expect(await session()).toMatchObject({ status: 'playing', video_id: V1, title: 'Primeira' })
    await add(owner, V2, 'Segunda')
    await add(owner, V3, 'Terceira')
    expect((await queue()).map((q) => q.video_id)).toEqual([V2, V3])
    const say = (await botMsgs()).map((m) => m.content)
    expect(say[0]).toContain('Primeira')
    expect(say[1]).toContain('Segunda')
  })

  it('pausar guarda a posição; retomar continua dela', async () => {
    await new Promise((r) => setTimeout(r, 1200))
    await ctl(member, 'pause')
    const s = await session()
    expect(s.status).toBe('paused')
    expect(s.paused_ms).toBeGreaterThanOrEqual(1000)
    await ctl(member, 'resume')
    expect((await session()).status).toBe('playing')
  })

  it('pular avança; o evento de fim com vídeo errado é ignorado (idempotente)', async () => {
    await ctl(owner, 'skip', V3) // vídeo atual é V1 → ignora
    expect((await session()).video_id).toBe(V1)
    await ctl(owner, 'skip', V1) // fim da faixa
    await ctl(member, 'skip', V1) // segundo cliente avisando o mesmo fim: sem efeito
    expect(await session()).toMatchObject({ video_id: V2, prev_video_id: V1 })
    expect((await queue()).map((q) => q.video_id)).toEqual([V3])
  })

  it('voltar: reinicia a faixa se já passou de 5 s; senão volta à anterior e devolve a atual ao início da fila', async () => {
    await ctl(member, 'back') // acabou de começar (<5 s) → volta para V1
    expect(await session()).toMatchObject({ video_id: V1 })
    expect((await queue()).map((q) => q.video_id)).toEqual([V2, V3])
    await db.admin(`update music_sessions set started_at = now() - interval '30 seconds' where channel_id=$1`, [voice])
    await ctl(member, 'back') // passou de 5 s → reinicia a mesma
    const s = await session()
    expect(s.video_id).toBe(V1)
    expect((await queue()).length).toBe(2)
  })

  it('remover da fila e parar limpam tudo; ocioso permite voltar à última tocada', async () => {
    const q = await queue()
    await db.as(member, `select public.music_remove($1,$2)`, [voice, q[0].id])
    expect((await queue()).map((x) => x.video_id)).toEqual([V3])
    await ctl(owner, 'stop')
    expect(await session()).toMatchObject({ status: 'idle', video_id: null })
    expect((await queue()).length).toBe(0)
  })

  it('avançar o fim da fila deixa ocioso e guarda a anterior', async () => {
    await add(owner, V1, 'Única')
    await ctl(owner, 'skip', V1)
    expect(await session()).toMatchObject({ status: 'idle', prev_video_id: V1 })
    await ctl(owner, 'back') // ocioso com anterior → toca a anterior de novo
    expect(await session()).toMatchObject({ status: 'playing', video_id: V1 })
  })
})

describe('validação e isolamento', () => {
  it('entradas inválidas são rejeitadas', async () => {
    expect(await errorOf(add(owner, 'curto'))).toMatch(/invalid_input|violates check/)
    expect(await errorOf(add(owner, "x'; drop table messages;--"))).toMatch(/invalid_input/)
    expect(await errorOf(ctl(owner, 'explodir'))).toMatch(/invalid_input/)
  })

  it('título é saneado (caracteres de controle e tamanho)', async () => {
    await ctl(owner, 'stop')
    await add(owner, V2, `Linha\n\tquebrada ${'x'.repeat(400)}`)
    const t = (await session()).title!
    expect(t.length).toBeLessThanOrEqual(200)
    expect(t).not.toMatch(/[\n\t]/)
  })

  it('forasteiro e canais inacessíveis/de texto são negados; estado não vaza', async () => {
    expect(await errorOf(add(outsider, V1))).toMatch(/forbidden/)
    expect(await errorOf(ctl(outsider, 'skip'))).toMatch(/forbidden/)
    expect(await errorOf(add(owner, V1, 'x', text))).toMatch(/forbidden/)
    expect(await db.as(outsider, `select * from music_sessions`)).toHaveLength(0)
    expect(await db.as(outsider, `select * from music_queue`)).toHaveLength(0)
    expect(await errorOf(db.as(member, `insert into music_queue (channel_id, ord, video_id, title) values ($1,1,$2,'x')`, [voice, V1]))).toMatch(/permission denied/i)
    expect(await errorOf(add(member, V1, 'x', privVoice))).toMatch(/forbidden/)
  })

  it('limite de 50 itens e limite de taxa', async () => {
    await ctl(owner, 'stop')
    const other = await db.createUser('spammer')
    const code = (await db.as<{ create_invite: string }>(owner, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
    await db.as(other, `select public.join_server($1)`, [code])
    await db.admin(`delete from rate_events`)
    await add(owner, V1, 'tocando')
    for (let i = 0; i < 50; i++) await db.admin(`insert into music_queue (channel_id, ord, video_id, title) values ($1,$2,$3,'f')`, [voice, i + 10, V2])
    expect(await errorOf(add(owner, V3))).toMatch(/limit_reached/)
    await db.admin(`delete from music_queue`)
    await db.admin(`delete from rate_events`)
    let failure: string | null = null
    for (let i = 0; i < 60 && !failure; i++) failure = await errorOf(add(other, V2, `t${i}`))
    expect(failure).toMatch(/rate_limited|limit_reached/)
  })

  it('desligar o bot remove-o dos membros e apaga as sessões do servidor', async () => {
    await db.as(owner, `select public.set_music_bot($1,false)`, [server])
    expect((await db.admin(`select 1 from members where server_id=$1 and user_id=$2`, [server, bot])).length).toBe(0)
    expect((await db.admin(`select 1 from music_sessions where server_id=$1`, [server])).length).toBe(0)
    expect(await errorOf(add(owner, V1))).toMatch(/bot_disabled/)
  })

  it('excluir o canal de voz remove sessão e fila (sem órfãos)', async () => {
    await db.as(owner, `select public.set_music_bot($1,true)`, [server])
    const ch = (await db.as<{ create_channel: string }>(owner, `select public.create_channel($1,'Temp','voice',null,false)`, [server]))[0].create_channel
    await db.admin(`delete from rate_events`)
    await add(owner, V1, 'a', ch)
    await add(owner, V2, 'b', ch)
    await db.as(owner, `select public.delete_channel($1)`, [ch])
    expect((await db.admin(`select 1 from music_sessions where channel_id=$1`, [ch])).length).toBe(0)
    expect((await db.admin(`select 1 from music_queue where channel_id=$1`, [ch])).length).toBe(0)
  })
})

describe('convite com link personalizado', () => {
  it('só quem gerencia o servidor cria; formato, reservadas e unicidade validados no banco', async () => {
    const d = await createDb()
    const [o, m, o2] = await Promise.all(['dono', 'membro', 'outro'].map((n) => d.createUser(n)))
    const s1 = (await d.as<{ create_server: string }>(o, `select public.create_server('A')`))[0].create_server
    const s2 = (await d.as<{ create_server: string }>(o2, `select public.create_server('B')`))[0].create_server
    const code = (await d.as<{ create_invite: string }>(o, `select public.create_invite($1,3600,null)`, [s1]))[0].create_invite
    await d.as(m, `select public.join_server($1)`, [code])
    const mk = (u: string, s: string, slug: string) => d.as(u, `select public.create_invite($1,3600,null,$2)`, [s, slug])
    expect((await mk(o, s1, 'Meu-Servidor'))[0]).toBeTruthy() // normaliza para minúsculas
    expect(await errorOf(mk(o, s1, 'meu-servidor'))).toMatch(/slug_taken/)
    expect(await errorOf(mk(o2, s2, 'meu-servidor'))).toMatch(/slug_taken/) // único globalmente
    expect(await errorOf(mk(o, s1, 'ab'))).toMatch(/invalid_slug/)
    expect(await errorOf(mk(o, s1, '-abc'))).toMatch(/invalid_slug/)
    expect(await errorOf(mk(o, s1, 'tem espaço'))).toMatch(/invalid_slug/)
    expect(await errorOf(mk(o, s1, 'admin'))).toMatch(/reserved_slug/)
    expect(await errorOf(mk(m, s1, 'do-membro'))).toMatch(/forbidden/) // membro comum não personaliza
    const joiner = await d.createUser('novo')
    expect(await d.as<{ join_server: string }>(joiner, `select public.join_server('MEU-SERVIDOR')`)).toHaveLength(1)
  })
})
