import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, errorOf, type Db } from './harness'

/**
 * Testes de isolamento e autorização contra o PostgreSQL real (PGlite) com as
 * migrations do projeto. Cada teste tenta uma ação SEM permissão e espera negação.
 */

let db: Db
let alice: string // dona
let bob: string // sem relação (de fora)
let carol: string // membro comum
let dave: string // moderador
let erin: string // administrador
let server: string
let general: string
let privateChan: string
let voice: string
let modRole: string
let adminRole: string

const uuid = () => crypto.randomUUID()

async function send(user: string, channel: string, content: string, extra: { reply?: string | null; att?: unknown[] } = {}) {
  const rows = await db.as<{ id: string }>(
    user,
    `select * from public.send_message($1, $2, null, $3, $4, $5::jsonb)`,
    [uuid(), channel, content, extra.reply ?? null, JSON.stringify(extra.att ?? [])],
  )
  return rows[0]
}

beforeAll(async () => {
  db = await createDb()
  alice = await db.createUser('alice')
  bob = await db.createUser('bob')
  carol = await db.createUser('carol')
  dave = await db.createUser('dave')
  erin = await db.createUser('erin')

  server = (await db.as<{ create_server: string }>(alice, `select public.create_server('Amigos')`))[0].create_server
  general = (await db.admin<{ id: string }>(`select id from channels where server_id = $1 and kind='text'`, [server]))[0].id
  voice = (await db.admin<{ id: string }>(`select id from channels where server_id = $1 and kind='voice'`, [server]))[0].id
  modRole = (await db.admin<{ id: string }>(`select id from roles where server_id = $1 and name='Moderador'`, [server]))[0].id
  adminRole = (await db.admin<{ id: string }>(`select id from roles where server_id = $1 and name='Administrador'`, [server]))[0].id

  const code = (await db.as<{ create_invite: string }>(alice, `select public.create_invite($1, 3600, null)`, [server]))[0].create_invite
  for (const u of [carol, dave, erin]) await db.as(u, `select public.join_server($1)`, [code])
  await db.as(alice, `select public.set_member_role($1,$2,$3,true)`, [server, dave, modRole])
  await db.as(alice, `select public.set_member_role($1,$2,$3,true)`, [server, erin, adminRole])

  privateChan = (await db.as<{ create_channel: string }>(
    alice, `select public.create_channel($1,'secreto','text',null,true)`, [server]))[0].create_channel
})

describe('isolamento de servidores e canais', () => {
  it('quem não é membro não vê servidor, canais, membros nem cargos', async () => {
    expect(await db.as(bob, `select * from servers where id = $1`, [server])).toHaveLength(0)
    expect(await db.as(bob, `select * from channels where server_id = $1`, [server])).toHaveLength(0)
    expect(await db.as(bob, `select * from members where server_id = $1`, [server])).toHaveLength(0)
    expect(await db.as(bob, `select * from roles where server_id = $1`, [server])).toHaveLength(0)
    expect(await db.as(bob, `select * from invites`)).toHaveLength(0)
  })

  it('anônimo não lê nada nem executa RPCs privadas', async () => {
    expect(await errorOf(db.anon(`select * from profiles`))).toMatch(/permission denied/i)
    expect(await errorOf(db.anon(`select public.create_server('x')`))).toMatch(/permission denied/i)
    expect(await errorOf(db.anon(`select * from messages`))).toMatch(/permission denied/i)
  })

  it('não é possível inserir/alterar/apagar diretamente em tabelas protegidas', async () => {
    expect(await errorOf(db.as(carol, `insert into messages (channel_id, author_id, content) values ($1,$2,'x')`, [general, carol])))
      .toMatch(/permission denied/i)
    expect(await errorOf(db.as(carol, `insert into members (server_id, user_id) values ($1,$2)`, [server, bob])))
      .toMatch(/permission denied/i)
    expect(await errorOf(db.as(carol, `update servers set owner_id = $2 where id = $1`, [server, carol])))
      .toMatch(/permission denied/i)
    expect(await errorOf(db.as(carol, `update roles set permissions = array['administrator'] where server_id = $1`, [server])))
      .toMatch(/permission denied/i)
    expect(await errorOf(db.as(carol, `delete from channels where id = $1`, [general]))).toMatch(/permission denied/i)
    expect(await errorOf(db.as(carol, `select * from rate_events`))).toMatch(/permission denied/i)
  })

  it('canal privado fica invisível e inacessível para membros sem permissão', async () => {
    const seen = await db.as<{ id: string }>(carol, `select id from channels where server_id = $1`, [server])
    expect(seen.map((r) => r.id)).not.toContain(privateChan)
    expect(await errorOf(send(carol, privateChan, 'oi?'))).toMatch(/forbidden/)
    // dono e administrador enxergam
    const adminSees = await db.as<{ id: string }>(erin, `select id from channels where id = $1`, [privateChan])
    expect(adminSees).toHaveLength(1)
  })

  it('mensagens de canal privado não vazam para quem não tem acesso', async () => {
    await send(alice, privateChan, 'segredo do grupo')
    expect(await db.as(carol, `select * from messages where channel_id = $1`, [privateChan])).toHaveLength(0)
    expect(await db.as(bob, `select * from messages where channel_id = $1`, [privateChan])).toHaveLength(0)
    expect(await db.as(carol, `select * from public.search_messages('segredo')`)).toHaveLength(0)
    expect(await db.as(alice, `select * from public.search_messages('segredo')`)).toHaveLength(1)
  })

  it('sobrescrita por usuário libera o canal privado; remover revoga', async () => {
    await db.as(alice, `select public.set_channel_overwrite($1, null, $2, true, null)`, [privateChan, carol])
    expect(await db.as(carol, `select * from messages where channel_id = $1`, [privateChan])).toHaveLength(1)
    expect((await send(carol, privateChan, 'agora posso')).id).toBeTruthy()
    await db.as(alice, `select public.set_channel_overwrite($1, null, $2, null, null)`, [privateChan, carol])
    expect(await db.as(carol, `select * from messages where channel_id = $1`, [privateChan])).toHaveLength(0)
  })

  it('canal público: negar envio via sobrescrita de cargo bloqueia envio mas mantém leitura', async () => {
    const memberRole = (await db.admin<{ id: string }>(`select id from roles where server_id=$1 and is_default`, [server]))[0].id
    const readonly = (await db.as<{ create_channel: string }>(alice, `select public.create_channel($1,'avisos','text',null,false)`, [server]))[0].create_channel
    await db.as(alice, `select public.set_channel_overwrite($1, $2, null, null, false)`, [readonly, memberRole])
    expect(await errorOf(send(carol, readonly, 'ola'))).toMatch(/forbidden/)
    expect((await send(alice, readonly, 'aviso do dono')).id).toBeTruthy()
    expect(await db.as(carol, `select * from messages where channel_id = $1`, [readonly])).toHaveLength(1)
  })

  it('canal de voz não aceita mensagens de texto', async () => {
    expect(await errorOf(send(alice, voice, 'x'))).toMatch(/forbidden/)
  })
})

describe('mensagens', () => {
  it('não-membro não envia, não edita e não apaga', async () => {
    expect(await errorOf(send(bob, general, 'invasor'))).toMatch(/forbidden/)
    const m = await send(carol, general, 'mensagem da carol')
    expect(await errorOf(db.as(bob, `select public.edit_message($1,'hack')`, [m.id]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(bob, `select public.delete_message($1)`, [m.id]))).toMatch(/forbidden/)
  })

  it('autor edita (marca editado) e outro membro comum não edita', async () => {
    const m = await send(carol, general, 'original')
    const edited = await db.as<{ content: string; edited_at: string }>(carol, `select * from public.edit_message($1,'editada')`, [m.id])
    expect(edited[0].content).toBe('editada')
    expect(edited[0].edited_at).toBeTruthy()
    expect(await errorOf(db.as(dave, `select public.edit_message($1,'moderador editando')`, [m.id]))).toMatch(/forbidden/)
  })

  it('apagar: membro comum não apaga mensagem alheia; moderador sim; fica registrado', async () => {
    const m = await send(alice, general, 'apagar-me')
    expect(await errorOf(db.as(carol, `select public.delete_message($1)`, [m.id]))).toMatch(/forbidden/)
    await db.as(dave, `select public.delete_message($1)`, [m.id])
    expect(await db.as(alice, `select * from messages where id = $1`, [m.id])).toHaveLength(0)
    const logs = await db.admin(`select * from mod_logs where server_id=$1 and action='message_deleted'`, [server])
    expect(logs.length).toBeGreaterThan(0)
  })

  it('envio é idempotente com o mesmo id (nova tentativa)', async () => {
    const id = uuid()
    const call = () => db.as<{ id: string }>(carol, `select * from public.send_message($1,$2,null,'retry',null,'[]')`, [id, general])
    const a = await call()
    const b = await call()
    expect(a[0].id).toBe(b[0].id)
    expect(await db.admin(`select 1 from messages where id=$1`, [id])).toHaveLength(1)
  })

  it('menções são extraídas no servidor e filtradas por acesso', async () => {
    // bob não é membro: a menção a ele é descartada; @everyone só com permissão
    const m = await send(dave, general, `oi <@${carol}> e <@${bob}> @everyone`)
    const row = (await db.admin<{ mention_user_ids: string[]; mention_everyone: boolean }>(
      `select mention_user_ids, mention_everyone from messages where id=$1`, [m.id]))[0]
    expect(row.mention_user_ids).toEqual([carol])
    expect(row.mention_everyone).toBe(true) // moderador tem mention_everyone
    const m2 = await send(carol, general, '@everyone olha isso')
    const row2 = (await db.admin<{ mention_everyone: boolean }>(`select mention_everyone from messages where id=$1`, [m2.id]))[0]
    expect(row2.mention_everyone).toBe(false)
  })

  it('contador de não lidas e menções por usuário; mark_read zera', async () => {
    const ch = (await db.as<{ create_channel: string }>(alice, `select public.create_channel($1,'unread','text',null,false)`, [server]))[0].create_channel
    await send(alice, ch, 'um')
    await send(alice, ch, `dois <@${carol}>`)
    const sum = await db.as<{ channel_id: string; unread_count: number; mention_count: number }>(carol, `select * from public.unread_summary()`)
    const row = sum.find((r) => r.channel_id === ch)!
    expect(row.unread_count).toBe(2)
    expect(row.mention_count).toBe(1)
    await db.as(carol, `select public.mark_read($1, null)`, [ch])
    const after = await db.as<{ channel_id: string }>(carol, `select * from public.unread_summary()`)
    expect(after.find((r) => r.channel_id === ch)).toBeUndefined()
  })

  it('limite de taxa bloqueia rajada de mensagens', async () => {
    const spammer = await db.createUser('spammer')
    const code = (await db.as<{ create_invite: string }>(alice, `select public.create_invite($1, 3600, null)`, [server]))[0].create_invite
    await db.as(spammer, `select public.join_server($1)`, [code])
    let failure: string | null = null
    for (let i = 0; i < 20 && !failure; i++) failure = await errorOf(send(spammer, general, `spam ${i}`))
    expect(failure).toMatch(/rate_limited/)
  })

  it('anexos: caminho precisa ser do próprio usuário/canal; sem permissão é negado', async () => {
    const ok = `c/${general}/${carol}/${uuid()}/foto.png`
    const m = await send(carol, general, 'com anexo', { att: [{ path: ok, name: 'foto.png', type: 'image/png', size: 1000 }] })
    expect(await db.as(dave, `select * from attachments where message_id=$1`, [m.id])).toHaveLength(1)
    expect(await db.as(bob, `select * from attachments where message_id=$1`, [m.id])).toHaveLength(0)
    const stolen = `c/${general}/${alice}/${uuid()}/x.png`
    expect(await errorOf(send(carol, general, 'x', { att: [{ path: stolen, name: 'x.png', type: 'image/png', size: 10 }] })))
      .toMatch(/invalid_input/)
    const traversal = `c/${general}/${carol}/../${alice}/x.png`
    expect(await errorOf(send(carol, general, 'x', { att: [{ path: traversal, name: 'x', type: 'image/png', size: 10 }] })))
      .toMatch(/invalid_input/)
    const big = `c/${general}/${carol}/${uuid()}/big.bin`
    expect(await errorOf(send(carol, general, 'x', { att: [{ path: big, name: 'big', type: 'x/y', size: 99999999 }] })))
      .toMatch(/invalid_input/)
  })

  it('reações exigem acesso ao canal', async () => {
    const m = await send(alice, general, 'reaja')
    expect(await db.as<{ toggle_reaction: boolean }>(carol, `select public.toggle_reaction($1,'👍')`, [m.id])).toEqual([{ toggle_reaction: true }])
    expect(await errorOf(db.as(bob, `select public.toggle_reaction($1,'👍')`, [m.id]))).toMatch(/forbidden/)
    expect(await db.as(bob, `select * from reactions`)).toHaveLength(0)
    expect(await db.as<{ toggle_reaction: boolean }>(carol, `select public.toggle_reaction($1,'👍')`, [m.id])).toEqual([{ toggle_reaction: false }])
  })

  it('fixar exige manage_messages em canais', async () => {
    const m = await send(alice, general, 'fixa')
    expect(await errorOf(db.as(carol, `select public.set_pinned($1,true)`, [m.id]))).toMatch(/forbidden/)
    await db.as(dave, `select public.set_pinned($1,true)`, [m.id])
    expect(await db.as(carol, `select * from messages where id=$1 and pinned_at is not null`, [m.id])).toHaveLength(1)
  })
})

describe('storage (políticas de anexos e mídia)', () => {
  const insertObj = (user: string, bucket: string, name: string) =>
    db.as(user, `insert into storage.objects (bucket_id, name, owner) values ($1,$2,$3)`, [bucket, name, user])

  it('só quem pode enviar no canal sobe anexos, sempre na própria pasta', async () => {
    expect(await errorOf(insertObj(carol, 'attachments', `c/${general}/${carol}/${uuid()}/a.png`))).toBeNull()
    expect(await errorOf(insertObj(carol, 'attachments', `c/${general}/${alice}/${uuid()}/a.png`))).toMatch(/row-level security/i)
    expect(await errorOf(insertObj(bob, 'attachments', `c/${general}/${bob}/${uuid()}/a.png`))).toMatch(/row-level security/i)
    expect(await errorOf(insertObj(carol, 'attachments', `c/${privateChan}/${carol}/${uuid()}/a.png`))).toMatch(/row-level security/i)
  })

  it('leitura de anexos segue o acesso ao canal', async () => {
    const path = `c/${general}/${carol}/${uuid()}/leitura.png`
    await insertObj(carol, 'attachments', path)
    expect(await db.as(dave, `select 1 from storage.objects where name=$1`, [path])).toHaveLength(1)
    expect(await db.as(bob, `select 1 from storage.objects where name=$1`, [path])).toHaveLength(0)
    const priv = `c/${privateChan}/${alice}/${uuid()}/p.png`
    await insertObj(alice, 'attachments', priv)
    expect(await db.as(carol, `select 1 from storage.objects where name=$1`, [priv])).toHaveLength(0)
  })

  it('avatares: só na própria pasta; ícones de servidor: só com manage_server', async () => {
    expect(await errorOf(insertObj(carol, 'public-media', `avatars/${carol}/a.png`))).toBeNull()
    expect(await errorOf(insertObj(carol, 'public-media', `avatars/${alice}/a.png`))).toMatch(/row-level security/i)
    expect(await errorOf(insertObj(carol, 'public-media', `servers/${server}/icon.png`))).toMatch(/row-level security/i)
    expect(await errorOf(insertObj(alice, 'public-media', `servers/${server}/icon.png`))).toBeNull()
  })
})

describe('cargos, hierarquia e moderação', () => {
  it('membro comum não gerencia nada', async () => {
    expect(await errorOf(db.as(carol, `select public.create_role($1,'x','#ffffff','{}')`, [server]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(carol, `select public.create_channel($1,'x','text',null,false)`, [server]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(carol, `select public.update_server($1,'novo',null,false)`, [server]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(carol, `select public.kick_member($1,$2,'')`, [server, dave]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(carol, `select public.delete_server($1)`, [server]))).toMatch(/forbidden/)
  })

  it('moderador não bane administrador nem o dono', async () => {
    expect(await errorOf(db.as(dave, `select public.ban_member($1,$2,'')`, [server, erin]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(dave, `select public.ban_member($1,$2,'')`, [server, alice]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(dave, `select public.kick_member($1,$2,'')`, [server, alice]))).toMatch(/forbidden/)
  })

  it('administrador não remove o dono; ninguém se autobane', async () => {
    expect(await errorOf(db.as(erin, `select public.ban_member($1,$2,'')`, [server, alice]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(erin, `select public.ban_member($1,$2,'')`, [server, erin]))).toMatch(/forbidden/)
  })

  it('moderador não altera cargos (sem manage_roles) nem se promove', async () => {
    expect(await errorOf(db.as(dave, `select public.set_member_role($1,$2,$3,true)`, [server, dave, adminRole]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(dave, `select public.update_role($1,null,null,array['administrator'],null)`, [modRole]))).toMatch(/forbidden/)
  })

  it('cargo personalizado com manage_roles não eleva além do próprio nível nem concede permissões que não possui', async () => {
    const frank = await db.createUser('frank')
    const code = (await db.as<{ create_invite: string }>(alice, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
    await db.as(frank, `select public.join_server($1)`, [code])
    const rid = (await db.as<{ create_role: string }>(alice, `select public.create_role($1,'Gerente','#112233',array['manage_roles','create_invite'])`, [server]))[0].create_role
    await db.as(alice, `select public.update_role($1,null,null,null,20)`, [rid])
    await db.as(alice, `select public.set_member_role($1,$2,$3,true)`, [server, frank, rid])
    // não pode conceder ban_members (não tem)
    expect(await errorOf(db.as(frank, `select public.create_role($1,'Ban','#ffffff',array['ban_members'])`, [server]))).toMatch(/forbidden/)
    // não pode atribuir cargo de nível maior (moderador=50 > 20)
    expect(await errorOf(db.as(frank, `select public.set_member_role($1,$2,$3,true)`, [server, carol, modRole]))).toMatch(/forbidden/)
    // pode criar cargo com permissão que possui
    expect((await db.as(frank, `select public.create_role($1,'Convidador','#ffffff',array['create_invite'])`, [server])).length).toBe(1)
    // não pode mexer em quem está acima (dave, nível 50)
    expect(await errorOf(db.as(frank, `select public.set_member_role($1,$2,$3,true)`, [server, dave, rid]))).toMatch(/forbidden/)
    // não pode se autoatribuir cargo maior
    expect(await errorOf(db.as(frank, `select public.set_member_role($1,$2,$3,true)`, [server, frank, modRole]))).toMatch(/forbidden/)
  })

  it('banimento remove o membro, impede reentrada por convite e pode ser revertido', async () => {
    const victim = await db.createUser('victim')
    const code = (await db.as<{ create_invite: string }>(alice, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
    await db.as(victim, `select public.join_server($1)`, [code])
    await db.as(dave, `select public.ban_member($1,$2,'spam')`, [server, victim])
    expect(await db.as(victim, `select * from servers where id=$1`, [server])).toHaveLength(0)
    expect(await errorOf(db.as(victim, `select public.join_server($1)`, [code]))).toMatch(/banned/)
    await db.as(dave, `select public.unban_member($1,$2)`, [server, victim])
    await db.as(victim, `select public.join_server($1)`, [code])
    expect(await db.as(victim, `select * from servers where id=$1`, [server])).toHaveLength(1)
  })

  it('apenas quem modera vê banimentos e logs', async () => {
    expect(await db.as(carol, `select * from bans`)).toHaveLength(0)
    expect(await db.as(carol, `select * from mod_logs`)).toHaveLength(0)
    expect((await db.as(dave, `select * from mod_logs where server_id=$1`, [server])).length).toBeGreaterThan(0)
  })

  it('dono não pode sair; transferência de propriedade só pelo dono para um membro', async () => {
    expect(await errorOf(db.as(alice, `select public.leave_server($1)`, [server]))).toMatch(/owner_cannot_leave/)
    expect(await errorOf(db.as(erin, `select public.transfer_ownership($1,$2)`, [server, erin]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(alice, `select public.transfer_ownership($1,$2)`, [server, bob]))).toMatch(/invalid_input/)
  })
})

describe('convites', () => {
  it('validação de expiração, limite de usos e revogação', async () => {
    const g1 = await db.createUser('g1')
    const g2 = await db.createUser('g2')
    const limited = (await db.as<{ create_invite: string }>(alice, `select public.create_invite($1,3600,1)`, [server]))[0].create_invite
    await db.as(g1, `select public.join_server($1)`, [limited])
    expect(await errorOf(db.as(g2, `select public.join_server($1)`, [limited]))).toMatch(/invite_invalid/)

    const expiring = (await db.as<{ create_invite: string }>(alice, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
    await db.admin(`update invites set expires_at = now() - interval '1 minute' where code=$1`, [expiring])
    expect(await errorOf(db.as(g2, `select public.join_server($1)`, [expiring]))).toMatch(/invite_invalid/)

    const revoked = (await db.as<{ create_invite: string }>(alice, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
    await db.as(alice, `select public.revoke_invite($1)`, [revoked])
    expect(await errorOf(db.as(g2, `select public.join_server($1)`, [revoked]))).toMatch(/invite_invalid/)
    expect(await errorOf(db.as(g2, `select public.join_server('inexistente')`))).toMatch(/invite_invalid/)
  })

  it('membro sem permissão não revoga convites de outros; só criador ou manage_server', async () => {
    const code = (await db.as<{ create_invite: string }>(alice, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
    expect(await errorOf(db.as(carol, `select public.revoke_invite($1)`, [code]))).toMatch(/forbidden/)
  })
})

describe('amigos, bloqueios e mensagens diretas', () => {
  let u1: string
  let u2: string
  let u3: string
  let dm: string

  beforeAll(async () => {
    u1 = await db.createUser('amigo1')
    u2 = await db.createUser('amigo2')
    u3 = await db.createUser('intruso')
    const code = (await db.as<{ create_invite: string }>(alice, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
    for (const u of [u1, u2, u3]) await db.as(u, `select public.join_server($1)`, [code])
  })

  it('fluxo de amizade: pedido, aceite e remoção', async () => {
    expect((await db.as<{ send_friend_request: string }>(u1, `select public.send_friend_request('amigo2')`))[0].send_friend_request).toBe('sent')
    expect(await errorOf(db.as(u1, `select public.respond_friend_request($1,true)`, [u1]))).toMatch(/not_found/)
    await db.as(u2, `select public.respond_friend_request($1,true)`, [u1])
    const f = await db.as<{ status: string }>(u1, `select status from friendships`)
    expect(f[0].status).toBe('accepted')
    expect(await errorOf(db.as(u1, `select public.send_friend_request('naoexiste')`))).toMatch(/not_found/)
  })

  it('DM é privada: terceiros não leem nem enviam', async () => {
    dm = (await db.as<{ open_dm: string }>(u1, `select public.open_dm($1)`, [u2]))[0].open_dm
    await db.as(u1, `select * from public.send_message($1,null,$2,'oi amigo',null,'[]')`, [uuid(), dm])
    expect(await db.as(u2, `select * from messages where dm_id=$1`, [dm])).toHaveLength(1)
    expect(await db.as(u3, `select * from messages where dm_id=$1`, [dm])).toHaveLength(0)
    expect(await db.as(u3, `select * from dm_conversations`)).toHaveLength(0)
    expect(await errorOf(db.as(u3, `select * from public.send_message($1,null,$2,'intruso',null,'[]')`, [uuid(), dm]))).toMatch(/forbidden/)
    expect(await db.as(u3, `select * from public.search_messages('oi amigo')`)).toHaveLength(0)
  })

  it('bloqueio impede novas mensagens e novos pedidos, e desfaz a amizade', async () => {
    await db.as(u2, `select public.block_user($1)`, [u1])
    expect(await db.as(u1, `select * from friendships`)).toHaveLength(0)
    expect(await errorOf(db.as(u1, `select * from public.send_message($1,null,$2,'ainda aqui?',null,'[]')`, [uuid(), dm]))).toMatch(/blocked/)
    expect(await errorOf(db.as(u1, `select public.send_friend_request('amigo2')`))).toMatch(/blocked/)
    expect(await errorOf(db.as(u1, `select public.open_dm($1)`, [u2]))).toMatch(/blocked/)
    await db.as(u2, `select public.unblock_user($1)`, [u1])
    expect((await db.as(u1, `select * from public.send_message($1,null,$2,'voltei',null,'[]')`, [uuid(), dm])).length).toBe(1)
  })

  it('política de DM "friends"/"nobody" é respeitada para conversas novas', async () => {
    await db.as(u3, `update user_prefs set dm_policy='nobody' where user_id=$1`, [u3])
    expect(await errorOf(db.as(u1, `select public.open_dm($1)`, [u3]))).toMatch(/dm_closed/)
    await db.as(u3, `update user_prefs set friend_requests='nobody' where user_id=$1`, [u3])
    expect(await errorOf(db.as(u1, `select public.send_friend_request('intruso')`))).toMatch(/requests_closed/)
  })

  it('desconhecidos sem contexto compartilhado não iniciam DM', async () => {
    const lonely = await db.createUser('solitario')
    expect(await errorOf(db.as(lonely, `select public.open_dm($1)`, [u1]))).toMatch(/forbidden/)
  })

  it('perfis só são visíveis com contexto compartilhado', async () => {
    const lonely = await db.admin<{ id: string }>(`select id from profiles where username='solitario'`)
    expect(await db.as(u1, `select * from profiles where id=$1`, [lonely[0].id])).toHaveLength(0)
    expect(await db.as(u1, `select * from profiles where id=$1`, [u2])).toHaveLength(1)
  })

  it('só o dono do perfil o altera, e só colunas permitidas', async () => {
    await db.as(u1, `update profiles set bio='olá' where id=$1`, [u1])
    expect(await db.as(u1, `select bio from profiles where id=$1`, [u1])).toEqual([{ bio: 'olá' }])
    const hijack = await db.as(u1, `update profiles set bio='hack' where id=$1 returning id`, [u2])
    expect(hijack).toHaveLength(0)
    expect(await errorOf(db.as(u1, `update profiles set disabled_at=null, created_at=now() where id=$1`, [u1]))).toMatch(/permission denied/i)
  })

  it('nome de usuário é único e validado', async () => {
    expect(await errorOf(db.as(u1, `update profiles set username='amigo2' where id=$1`, [u1]))).toMatch(/duplicate key/i)
    expect(await errorOf(db.as(u1, `update profiles set username='Inválido!' where id=$1`, [u1]))).toMatch(/profiles_username_format/)
    expect(await db.anon(`select public.username_available('amigo2')`)).toEqual([{ username_available: false }])
    expect(await db.anon(`select public.username_available('livre_123')`)).toEqual([{ username_available: true }])
  })
})

describe('Realtime e ciclo de vida', () => {
  it('autorização de tópicos realtime respeita membership e canais privados', async () => {
    const check = async (u: string, topic: string, write = false) =>
      (await db.admin<{ ok: boolean }>(`select private.realtime_topic_allowed($1,$2,$3) as ok`, [topic, u, write]))[0].ok
    expect(await check(carol, `srv:${server}`)).toBe(true)
    expect(await check(bob, `srv:${server}`)).toBe(false)
    expect(await check(carol, `chan:${privateChan}`)).toBe(false)
    expect(await check(alice, `chan:${privateChan}`)).toBe(true)
    expect(await check(carol, `fr:${alice}`, true)).toBe(false) // só escreve na própria presença
    expect(await check(carol, `fr:${carol}`, true)).toBe(true)
    expect(await check(carol, 'qualquer-coisa')).toBe(false)
  })

  it('excluir canal remove mensagens (sem órfãos); excluir servidor limpa tudo', async () => {
    const owner = await db.createUser('dono2')
    const sid = (await db.as<{ create_server: string }>(owner, `select public.create_server('Temp')`))[0].create_server
    const ch = (await db.admin<{ id: string }>(`select id from channels where server_id=$1 and kind='text'`, [sid]))[0].id
    await send(owner, ch, 'temporária')
    await db.as(owner, `select public.delete_channel($1)`, [ch])
    expect(await db.admin(`select 1 from messages where channel_id=$1`, [ch])).toHaveLength(0)
    await db.as(owner, `select public.delete_server($1)`, [sid])
    expect(await db.admin(`select 1 from roles where server_id=$1`, [sid])).toHaveLength(0)
    expect(await db.admin(`select 1 from members where server_id=$1`, [sid])).toHaveLength(0)
  })

  it('exclusão de conta transfere servidores e mantém mensagens sem autor', async () => {
    const owner = await db.createUser('saindo')
    const heir = await db.createUser('herdeiro')
    const sid = (await db.as<{ create_server: string }>(owner, `select public.create_server('Herança')`))[0].create_server
    const code = (await db.as<{ create_invite: string }>(owner, `select public.create_invite($1,3600,null)`, [sid]))[0].create_invite
    await db.as(heir, `select public.join_server($1)`, [code])
    const ch = (await db.admin<{ id: string }>(`select id from channels where server_id=$1 and kind='text'`, [sid]))[0].id
    const m = await send(owner, ch, 'ultima mensagem')
    expect(await errorOf(db.as(owner, `select public.prepare_account_deletion($1)`, [owner]))).toMatch(/permission denied/i)
    await db.admin(`select public.prepare_account_deletion($1)`, [owner])
    await db.admin(`delete from auth.users where id=$1`, [owner])
    expect((await db.admin<{ owner_id: string }>(`select owner_id from servers where id=$1`, [sid]))[0].owner_id).toBe(heir)
    expect((await db.admin<{ author_id: string | null }>(`select author_id from messages where id=$1`, [m.id]))[0].author_id).toBeNull()
  })

  it('conta desativada não envia mensagens nem vê canais', async () => {
    const tmp = await db.createUser('desativando')
    const code = (await db.as<{ create_invite: string }>(alice, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
    await db.as(tmp, `select public.join_server($1)`, [code])
    await send(tmp, general, 'ativo')
    await db.as(tmp, `select public.deactivate_account()`)
    expect(await errorOf(send(tmp, general, 'desativado'))).toMatch(/forbidden/)
    expect(await db.as(tmp, `select * from channels where server_id=$1`, [server])).toHaveLength(0)
    await db.as(tmp, `select public.reactivate_account()`)
    expect((await send(tmp, general, 'de volta')).id).toBeTruthy()
  })
})
