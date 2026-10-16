import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, errorOf, type Db } from './harness'

let db: Db
let owner: string, admin: string, mod: string, victim: string, peer: string, outsider: string
let server: string, text: string, voiceA: string, voiceB: string, privVoice: string

const uuid = () => crypto.randomUUID()
const send = (u: string, c: string, t = 'oi') => db.as(u, `select * from public.send_message($1,$2,null,$3,null,'[]')`, [uuid(), c, t])
const member = async (u: string) => (await db.admin<{ timeout_until: string | null; voice_muted: boolean; voice_deafened: boolean }>(`select timeout_until, voice_muted, voice_deafened from members where server_id=$1 and user_id=$2`, [server, u]))[0]
const sent = async () => db.admin<{ topic: string; event: string; payload: Record<string, unknown> }>(`select topic, event, payload from realtime.sent_log order by id`)

beforeAll(async () => {
  db = await createDb()
  ;[owner, admin, mod, victim, peer, outsider] = await Promise.all(['dono', 'adm', 'moderador', 'vitima', 'colega', 'fora'].map((n) => db.createUser(n)))
  server = (await db.as<{ create_server: string }>(owner, `select public.create_server('Mod')`))[0].create_server
  text = (await db.admin<{ id: string }>(`select id from channels where server_id=$1 and kind='text'`, [server]))[0].id
  voiceA = (await db.admin<{ id: string }>(`select id from channels where server_id=$1 and kind='voice'`, [server]))[0].id
  voiceB = (await db.as<{ create_channel: string }>(owner, `select public.create_channel($1,'Sala B','voice',null,false)`, [server]))[0].create_channel
  privVoice = (await db.as<{ create_channel: string }>(owner, `select public.create_channel($1,'Sala secreta','voice',null,true)`, [server]))[0].create_channel
  const code = (await db.as<{ create_invite: string }>(owner, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
  for (const u of [admin, mod, victim, peer]) await db.as(u, `select public.join_server($1)`, [code])
  const role = async (n: string) => (await db.admin<{ id: string }>(`select id from roles where server_id=$1 and name=$2`, [server, n]))[0].id
  await db.as(owner, `select public.set_member_role($1,$2,$3,true)`, [server, admin, await role('Administrador')])
  await db.as(owner, `select public.set_member_role($1,$2,$3,true)`, [server, mod, await role('Moderador')])
})

describe('castigo (timeout)', () => {
  it('moderador castiga membro comum; vítima não envia nem reage; leitura continua', async () => {
    const m = (await send(peer, text, 'antes')) as unknown as { id: string }[]
    await db.as(mod, `select public.timeout_member($1,$2,300,'spam')`, [server, victim])
    expect((await member(victim)).timeout_until).not.toBeNull()
    expect(await errorOf(send(victim, text))).toMatch(/timed_out/)
    expect(await errorOf(db.as(victim, `select public.toggle_reaction($1,'👍')`, [m[0].id]))).toMatch(/timed_out/)
    expect((await db.as(victim, `select * from messages where channel_id=$1`, [text])).length).toBeGreaterThan(0)
    expect((await send(peer, text, 'colega continua')).length).toBe(1)
  })

  it('DMs não são afetadas pelo castigo do servidor', async () => {
    const dm = (await db.as<{ open_dm: string }>(victim, `select public.open_dm($1)`, [peer]))[0].open_dm
    expect((await db.as(victim, `select * from public.send_message($1,null,$2,'dm ok',null,'[]')`, [uuid(), dm])).length).toBe(1)
  })

  it('o token de voz sai sem fala/vídeo/tela durante o castigo, e volta ao normal ao remover', async () => {
    const a = (await db.as<{ can_speak: boolean; can_video: boolean; can_screen: boolean; can_listen: boolean }>(victim, `select * from public.voice_access($1)`, [voiceA]))[0]
    expect(a).toMatchObject({ can_speak: false, can_video: false, can_screen: false, can_listen: true })
    await db.as(mod, `select public.timeout_member($1,$2,0)`, [server, victim])
    expect((await member(victim)).timeout_until).toBeNull()
    const b = (await db.as<{ can_speak: boolean }>(victim, `select * from public.voice_access($1)`, [voiceA]))[0]
    expect(b.can_speak).toBe(true)
    expect((await send(victim, text, 'voltei')).length).toBe(1)
  })

  it('o castigo expira sozinho', async () => {
    await db.as(mod, `select public.timeout_member($1,$2,60,'')`, [server, victim])
    await db.admin(`update members set timeout_until = now() - interval '1 second' where server_id=$1 and user_id=$2`, [server, victim])
    expect((await send(victim, text, 'expirou')).length).toBe(1)
  })

  it('hierarquia e permissão: membro comum, moderador→administrador/dono e autocastigo são negados', async () => {
    expect(await errorOf(db.as(peer, `select public.timeout_member($1,$2,60)`, [server, victim]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(mod, `select public.timeout_member($1,$2,60)`, [server, admin]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(mod, `select public.timeout_member($1,$2,60)`, [server, owner]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(mod, `select public.timeout_member($1,$2,60)`, [server, mod]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(outsider, `select public.timeout_member($1,$2,60)`, [server, victim]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(mod, `select public.timeout_member($1,$2,5)`, [server, victim]))).toMatch(/invalid_input/)
    expect(await errorOf(db.as(mod, `select public.timeout_member($1,$2,99999999)`, [server, victim]))).toMatch(/invalid_input/)
  })

  it('o castigo fica registrado no log de moderação', async () => {
    const logs = await db.admin<{ action: string }>(`select action from mod_logs where server_id=$1 and action like 'timeout%'`, [server])
    expect(logs.length).toBeGreaterThanOrEqual(2)
  })
})

describe('moderação de voz (silenciar, ensurdecer, desconectar, mover)', () => {
  it('silenciar/ensurdecer gravam o estado e refletem nas permissões de mídia', async () => {
    const r = await db.as<{ voice_moderate: Record<string, unknown> }>(mod, `select public.voice_moderate($1,$2,'mute',$3)`, [server, victim, voiceA])
    expect(r[0].voice_moderate).toMatchObject({ action: 'mute', can_speak: false, can_video: false, can_screen: false, can_listen: true })
    expect((await member(victim)).voice_muted).toBe(true)
    const t = (await db.as<{ can_speak: boolean }>(victim, `select * from public.voice_access($1)`, [voiceA]))[0]
    expect(t.can_speak).toBe(false) // não consegue voltar com um token novo
    const d = await db.as<{ voice_moderate: Record<string, unknown> }>(mod, `select public.voice_moderate($1,$2,'deafen',$3)`, [server, victim, voiceA])
    expect(d[0].voice_moderate).toMatchObject({ can_listen: false })
    expect((await db.as<{ can_listen: boolean }>(victim, `select * from public.voice_access($1)`, [voiceA]))[0].can_listen).toBe(false)
    await db.as(mod, `select public.voice_moderate($1,$2,'unmute',$3)`, [server, victim, voiceA])
    await db.as(mod, `select public.voice_moderate($1,$2,'undeafen',$3)`, [server, victim, voiceA])
    expect(await member(victim)).toMatchObject({ voice_muted: false, voice_deafened: false })
  })

  it('desconectar e mover enviam comando privado ao alvo (cmd:<uid>)', async () => {
    await db.as(mod, `select public.voice_moderate($1,$2,'disconnect',$3)`, [server, victim, voiceA])
    await db.as(mod, `select public.voice_moderate($1,$2,'move',$3,$4)`, [server, victim, voiceA, voiceB])
    const log = await sent()
    const toVictim = log.filter((l) => l.topic === `cmd:${victim}`)
    expect(toVictim.map((l) => l.event)).toEqual(['disconnect', 'move'])
    expect(toVictim[1].payload.channel_id).toBe(voiceB)
  })

  it('mover exige canal de voz de destino acessível ao alvo (canal privado e de texto são negados)', async () => {
    expect(await errorOf(db.as(mod, `select public.voice_moderate($1,$2,'move',$3,$4)`, [server, victim, voiceA, text]))).toMatch(/invalid_input/)
    // moderador não administra o canal privado (não o enxerga)
    expect(await errorOf(db.as(mod, `select public.voice_moderate($1,$2,'move',$3,$4)`, [server, victim, voiceA, privVoice]))).toMatch(/invalid_input/)
    expect(await errorOf(db.as(mod, `select public.voice_moderate($1,$2,'move',$3,null)`, [server, victim, voiceA]))).toMatch(/invalid_input/)
  })

  it('permissão e hierarquia: sem permissão, contra superior/dono ou a si mesmo = negado', async () => {
    for (const a of ['mute', 'deafen', 'disconnect']) {
      expect(await errorOf(db.as(peer, `select public.voice_moderate($1,$2,$3,$4)`, [server, victim, a, voiceA]))).toMatch(/forbidden/)
      expect(await errorOf(db.as(mod, `select public.voice_moderate($1,$2,$3,$4)`, [server, admin, a, voiceA]))).toMatch(/forbidden/)
      expect(await errorOf(db.as(admin, `select public.voice_moderate($1,$2,$3,$4)`, [server, owner, a, voiceA]))).toMatch(/forbidden/)
      expect(await errorOf(db.as(mod, `select public.voice_moderate($1,$2,$3,$4)`, [server, mod, a, voiceA]))).toMatch(/forbidden/)
      expect(await errorOf(db.as(outsider, `select public.voice_moderate($1,$2,$3,$4)`, [server, victim, a, voiceA]))).toMatch(/forbidden/)
    }
    expect(await errorOf(db.as(mod, `select public.voice_moderate($1,$2,'explodir',$3)`, [server, victim, voiceA]))).toMatch(/invalid_input/)
  })

  it('só o próprio usuário lê o tópico de comandos', async () => {
    const q = async (u: string, topic: string, write = false) => (await db.admin<{ ok: boolean }>(`select private.realtime_topic_allowed($1,$2,$3) as ok`, [topic, u, write]))[0].ok
    expect(await q(victim, `cmd:${victim}`)).toBe(true)
    expect(await q(mod, `cmd:${victim}`)).toBe(false)
    expect(await q(victim, `cmd:${victim}`, true)).toBe(false)
  })

  it('novas permissões existem nos cargos de moderação e não nos membros comuns', async () => {
    const perms = (await db.admin<{ permissions: string[] }>(`select permissions from roles where server_id=$1 and name='Moderador'`, [server]))[0].permissions
    expect(perms).toEqual(expect.arrayContaining(['moderate_members', 'mute_members', 'deafen_members', 'move_members']))
    const def = (await db.admin<{ permissions: string[] }>(`select permissions from roles where server_id=$1 and is_default`, [server]))[0].permissions
    expect(def).not.toContain('moderate_members')
  })
})
