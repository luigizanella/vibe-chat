import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, errorOf, type Db } from './harness'

let db: Db
let owner: string, member: string
let server: string, voice: string, afk: string, text: string

beforeAll(async () => {
  db = await createDb()
  ;[owner, member] = await Promise.all(['dono', 'membro'].map((n) => db.createUser(n)))
  server = (await db.as<{ create_server: string }>(owner, `select public.create_server('AFK')`))[0].create_server
  voice = (await db.admin<{ id: string }>(`select id from channels where server_id=$1 and kind='voice'`, [server]))[0].id
  text = (await db.admin<{ id: string }>(`select id from channels where server_id=$1 and kind='text'`, [server]))[0].id
  afk = (await db.as<{ create_channel: string }>(owner, `select public.create_channel($1,'ausente','voice',null,false)`, [server]))[0].create_channel
  const code = (await db.as<{ create_invite: string }>(owner, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
  await db.as(member, `select public.join_server($1)`, [code])
})

describe('canal de ausentes (AFK)', () => {
  it('só quem gerencia o servidor configura; só canal de voz do próprio servidor; tempos permitidos', async () => {
    expect(await errorOf(db.as(member, `select public.set_afk($1,$2,5)`, [server, afk]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(owner, `select public.set_afk($1,$2,5)`, [server, text]))).toMatch(/invalid_input/)
    expect(await errorOf(db.as(owner, `select public.set_afk($1,$2,7)`, [server, afk]))).toMatch(/invalid_input/)
    await db.as(owner, `select public.set_afk($1,$2,10)`, [server, afk])
    const s = (await db.admin<{ afk_channel_id: string; afk_timeout_minutes: number }>(`select afk_channel_id, afk_timeout_minutes from servers where id=$1`, [server]))[0]
    expect(s).toMatchObject({ afk_channel_id: afk, afk_timeout_minutes: 10 })
  })

  it('clientes não gravam as colunas diretamente', async () => {
    expect(await errorOf(db.as(owner, `update servers set afk_timeout_minutes = 1 where id = $1`, [server]))).toMatch(/permission denied|forbidden|row-level/i)
  })

  it('no canal de ausentes o token é sem microfone/câmera/tela (mudo no servidor); nos outros fala normal', async () => {
    const a = (await db.as<{ can_speak: boolean; can_video: boolean; can_screen: boolean; can_listen: boolean }>(member, `select * from public.voice_access($1)`, [afk]))[0]
    expect(a).toMatchObject({ can_speak: false, can_video: false, can_screen: false, can_listen: true })
    const v = (await db.as<{ can_speak: boolean }>(member, `select * from public.voice_access($1)`, [voice]))[0]
    expect(v.can_speak).toBe(true)
  })

  it('sem canal configurado, tudo volta ao normal', async () => {
    await db.as(owner, `select public.set_afk($1,null,5)`, [server])
    const a = (await db.as<{ can_speak: boolean }>(member, `select * from public.voice_access($1)`, [afk]))[0]
    expect(a.can_speak).toBe(true)
  })
})
