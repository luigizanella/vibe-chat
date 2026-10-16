import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, errorOf, type Db } from './harness'

let db: Db
let owner: string, admin: string, mod: string, manager: string, member: string, outsider: string
let server: string, modRole: string, adminRole: string, memberRole: string

const roleRow = async (id: string) => (await db.admin<{ position: number; hoist: boolean; name: string }>(`select position, hoist, name from roles where id=$1`, [id]))[0]
const hasRole = async (user: string, role: string) =>
  (await db.admin(`select 1 from member_roles where user_id=$1 and role_id=$2`, [user, role])).length === 1
const order = async () => (await db.admin<{ id: string }>(`select id from roles where server_id=$1 and not is_default order by position desc, id`, [server])).map((r) => r.id)

beforeAll(async () => {
  db = await createDb()
  ;[owner, admin, mod, manager, member, outsider] = await Promise.all(['dono', 'adm', 'moderador', 'gerente', 'membro', 'fora'].map((n) => db.createUser(n)))
  server = (await db.as<{ create_server: string }>(owner, `select public.create_server('Cargos')`))[0].create_server
  modRole = (await db.admin<{ id: string }>(`select id from roles where server_id=$1 and name='Moderador'`, [server]))[0].id
  adminRole = (await db.admin<{ id: string }>(`select id from roles where server_id=$1 and name='Administrador'`, [server]))[0].id
  memberRole = (await db.admin<{ id: string }>(`select id from roles where server_id=$1 and is_default`, [server]))[0].id
  const code = (await db.as<{ create_invite: string }>(owner, `select public.create_invite($1,3600,null)`, [server]))[0].create_invite
  for (const u of [admin, mod, manager, member]) await db.as(u, `select public.join_server($1)`, [code])
  await db.as(owner, `select public.set_member_role($1,$2,$3,true)`, [server, admin, adminRole])
  await db.as(owner, `select public.set_member_role($1,$2,$3,true)`, [server, mod, modRole])
})

describe('atribuição de cargos (bug do dono)', () => {
  it('o dono aplica e retira cargos em si mesmo e nos outros', async () => {
    await db.as(owner, `select public.set_member_role($1,$2,$3,true)`, [server, owner, modRole])
    expect(await hasRole(owner, modRole)).toBe(true)
    await db.as(owner, `select public.set_member_role($1,$2,$3,false)`, [server, owner, modRole])
    expect(await hasRole(owner, modRole)).toBe(false)
    await db.as(owner, `select public.set_member_role($1,$2,$3,true)`, [server, member, modRole])
    expect(await hasRole(member, modRole)).toBe(true)
    await db.as(owner, `select public.set_member_role($1,$2,$3,false)`, [server, member, modRole])
  })

  it('cargo padrão não pode ser atribuído; alvo precisa ser membro', async () => {
    expect(await errorOf(db.as(owner, `select public.set_member_role($1,$2,$3,true)`, [server, member, memberRole]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(owner, `select public.set_member_role($1,$2,$3,true)`, [server, outsider, modRole]))).toMatch(/forbidden/)
  })

  it('administrador atribui cargos abaixo do seu nível, inclusive em si, mas não o próprio nível', async () => {
    const low = (await db.as<{ create_role: string }>(owner, `select public.create_role($1,'Baixo','#112233',array['create_invite'])`, [server]))[0].create_role
    await db.as(admin, `select public.set_member_role($1,$2,$3,true)`, [server, admin, low])
    expect(await hasRole(admin, low)).toBe(true)
    expect(await errorOf(db.as(admin, `select public.set_member_role($1,$2,$3,true)`, [server, member, adminRole]))).toMatch(/forbidden/)
  })

  it('sem manage_roles ninguém atribui; moderador não se promove', async () => {
    expect(await errorOf(db.as(mod, `select public.set_member_role($1,$2,$3,true)`, [server, mod, adminRole]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(member, `select public.set_member_role($1,$2,$3,true)`, [server, member, modRole]))).toMatch(/forbidden/)
  })

  it('auto-atribuição só com todas as permissões do cargo (sem brecha de promoção)', async () => {
    const mgr = (await db.as<{ create_role: string }>(owner, `select public.create_role($1,'Gerente','#445566',array['manage_roles','create_invite'])`, [server]))[0].create_role
    await db.as(owner, `select public.update_role($1,null,null,null,20,null)`, [mgr])
    await db.as(owner, `select public.set_member_role($1,$2,$3,true)`, [server, manager, mgr])
    const banRole = (await db.as<{ create_role: string }>(owner, `select public.create_role($1,'Banidor','#778899',array['ban_members'])`, [server]))[0].create_role
    const inviteRole = (await db.as<{ create_role: string }>(owner, `select public.create_role($1,'Convites','#99aabb',array['create_invite'])`, [server]))[0].create_role
    expect(await errorOf(db.as(manager, `select public.set_member_role($1,$2,$3,true)`, [server, manager, banRole]))).toMatch(/forbidden/)
    await db.as(manager, `select public.set_member_role($1,$2,$3,true)`, [server, manager, inviteRole])
    expect(await hasRole(manager, inviteRole)).toBe(true)
    // pode retirar de si
    await db.as(manager, `select public.set_member_role($1,$2,$3,false)`, [server, manager, inviteRole])
    expect(await hasRole(manager, inviteRole)).toBe(false)
    // não toca em quem está acima (moderador, nível 50)
    expect(await errorOf(db.as(manager, `select public.set_member_role($1,$2,$3,true)`, [server, mod, inviteRole]))).toMatch(/forbidden/)
  })
})

describe('criar cargo com membros, exibição separada e bots', () => {
  it('cria com membros e hoist', async () => {
    const rid = (await db.as<{ create_role: string }>(owner,
      `select public.create_role($1,'Fundadores','#ff0066',array['create_invite'],true,$2::uuid[])`, [server, [member, mod]]))[0].create_role
    expect(await hasRole(member, rid)).toBe(true)
    expect(await hasRole(mod, rid)).toBe(true)
    expect((await roleRow(rid)).hoist).toBe(true)
  })

  it('não cria cargo com membro inexistente nem sem permissão (transação revertida)', async () => {
    const before = (await db.admin(`select 1 from roles where server_id=$1`, [server])).length
    expect(await errorOf(db.as(owner, `select public.create_role($1,'X','#ffffff','{}',true,$2::uuid[])`, [server, [outsider]]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(member, `select public.create_role($1,'Y','#ffffff','{}',true,'{}')`, [server]))).toMatch(/forbidden/)
    expect((await db.admin(`select 1 from roles where server_id=$1`, [server])).length).toBe(before)
  })

  it('hoist editável; cargo padrão nunca é exibido separado; bots não são auto-declaráveis', async () => {
    const rid = (await order())[0]
    await db.as(owner, `select public.update_role($1,null,null,null,null,false)`, [rid])
    expect((await roleRow(rid)).hoist).toBe(false)
    await db.as(owner, `select public.update_role($1,null,null,null,null,true)`, [memberRole])
    expect((await roleRow(memberRole)).hoist).toBe(false)
    expect(await errorOf(db.as(member, `update profiles set is_bot = true where id = $1`, [member]))).toMatch(/permission denied/i)
  })
})

describe('reordenar cargos (arrastar)', () => {
  it('o dono reordena livremente; posições ficam únicas e na ordem enviada', async () => {
    const cur = await order()
    const next = [...cur].reverse()
    await db.as(owner, `select public.reorder_roles($1,$2::uuid[])`, [server, next])
    expect(await order()).toEqual(next)
    const pos = (await db.admin<{ position: number }>(`select position from roles where server_id=$1 and not is_default`, [server])).map((r) => r.position)
    expect(new Set(pos).size).toBe(pos.length)
    await db.as(owner, `select public.reorder_roles($1,$2::uuid[])`, [server, cur])
  })

  it('entradas inválidas são rejeitadas (faltando, repetido, de outro servidor)', async () => {
    const cur = await order()
    expect(await errorOf(db.as(owner, `select public.reorder_roles($1,$2::uuid[])`, [server, cur.slice(1)]))).toMatch(/invalid_input/)
    expect(await errorOf(db.as(owner, `select public.reorder_roles($1,$2::uuid[])`, [server, [cur[0], ...cur.slice(0, -1)]]))).toMatch(/invalid_input/)
    expect(await errorOf(db.as(owner, `select public.reorder_roles($1,$2::uuid[])`, [server, [memberRole, ...cur.slice(1)]]))).toMatch(/invalid_input/)
  })

  it('administrador não derruba nem ultrapassa o próprio cargo; pode reordenar os de baixo', async () => {
    const cur = await order() // admin (100) no topo
    expect(cur[0]).toBe(adminRole)
    // coloca o Moderador acima do Administrador: proibido
    const bad = [modRole, adminRole, ...cur.filter((x) => x !== modRole && x !== adminRole)]
    expect(await errorOf(db.as(admin, `select public.reorder_roles($1,$2::uuid[])`, [server, bad]))).toMatch(/forbidden/)
    // inverte só os cargos abaixo do administrador: permitido
    const below = cur.slice(1).reverse()
    await db.as(admin, `select public.reorder_roles($1,$2::uuid[])`, [server, [adminRole, ...below]])
    expect(await order()).toEqual([adminRole, ...below])
    expect((await roleRow(adminRole)).position).toBeGreaterThan((await roleRow(below[0])).position)
  })

  it('sem manage_roles não reordena', async () => {
    expect(await errorOf(db.as(member, `select public.reorder_roles($1,$2::uuid[])`, [server, await order()]))).toMatch(/forbidden/)
    expect(await errorOf(db.as(outsider, `select public.reorder_roles($1,$2::uuid[])`, [server, await order()]))).toMatch(/forbidden/)
  })
})
