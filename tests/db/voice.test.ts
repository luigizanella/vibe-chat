import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, errorOf, type Db } from './harness'

let db: Db
let owner: string, member: string, outsider: string
let server: string, voice: string, privateVoice: string, text: string

beforeAll(async () => {
  db = await createDb()
  owner = await db.createUser('dono')
  member = await db.createUser('membro')
  outsider = await db.createUser('forasteiro')
  server = (await db.as<{ create_server: string }>(owner, `select public.create_server('Voz')`))[0].create_server
  voice = (await db.admin<{ id: string }>(`select id from channels where server_id=$1 and kind='voice'`, [server]))[0].id
  text = (await db.admin<{ id: string }>(`select id from channels where server_id=$1 and kind='text'`, [server]))[0].id
  privateVoice = (await db.as<{ create_channel: string }>(owner, `select public.create_channel($1,'Sala secreta','voice',null,true)`, [server]))[0].create_channel
  const code = (await db.as<{ create_invite: string }>(owner, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
  await db.as(member, `select public.join_server($1)`, [code])
})

describe('voice_access (autorização de tokens LiveKit)', () => {
  it('membro conecta em canal de voz público e recebe permissões de mídia', async () => {
    const r = await db.as<{ can_connect: boolean; can_speak: boolean; can_video: boolean; can_screen: boolean; display_name: string }>(
      member, `select * from public.voice_access($1)`, [voice])
    expect(r[0]).toMatchObject({ can_connect: true, can_speak: true, can_video: true, can_screen: true, display_name: 'membro' })
  })

  it('forasteiro, canal privado e canal de texto são negados', async () => {
    expect(await errorOf(db.as(outsider, `select * from public.voice_access($1)`, [voice]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(member, `select * from public.voice_access($1)`, [privateVoice]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(member, `select * from public.voice_access($1)`, [text]))).toMatch(/forbidden/)
    expect(await errorOf(db.anon(`select * from public.voice_access($1)`, [voice]))).toMatch(/permission denied/i)
  })

  it('remover permissões de fala/vídeo/tela do cargo padrão reflete no token', async () => {
    const memberRole = (await db.admin<{ id: string }>(`select id from roles where server_id=$1 and is_default`, [server]))[0].id
    await db.as(owner, `select public.update_role($1,null,null,array['send_messages','connect_voice'],null)`, [memberRole])
    const r = await db.as<{ can_speak: boolean; can_video: boolean; can_screen: boolean }>(
      member, `select * from public.voice_access($1)`, [voice])
    expect(r[0]).toMatchObject({ can_speak: false, can_video: false, can_screen: false })
  })

  it('can_send_in_channel reflete permissões e sobrescritas do canal', async () => {
    const q = (u: string, c: string) => db.as<{ can_send_in_channel: boolean }>(u, `select public.can_send_in_channel($1)`, [c])
    expect((await q(owner, text))[0].can_send_in_channel).toBe(true)
    expect((await q(outsider, text))[0].can_send_in_channel).toBe(false)
    const memberRole = (await db.admin<{ id: string }>(`select id from roles where server_id=$1 and is_default`, [server]))[0].id
    await db.as(owner, `select public.set_channel_overwrite($1,$2,null,null,false)`, [text, memberRole])
    expect((await q(member, text))[0].can_send_in_channel).toBe(false)
    expect((await q(owner, text))[0].can_send_in_channel).toBe(true)
    await db.as(owner, `select public.set_channel_overwrite($1,$2,null,null,null)`, [text, memberRole])
  })

  it('limita a taxa de emissão de tokens', async () => {
    let failure: string | null = null
    for (let i = 0; i < 40 && !failure; i++) failure = await errorOf(db.as(owner, `select * from public.voice_access($1)`, [voice]))
    expect(failure).toMatch(/rate_limited/)
  })
})
