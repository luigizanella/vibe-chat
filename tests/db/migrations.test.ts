import { describe, expect, it } from 'vitest'
import { createDb } from './harness'

describe('migrations', () => {
  it('aplicam do zero e criam perfil via trigger', async () => {
    const db = await createDb()
    const id = await db.createUser('alice')
    const rows = await db.admin<{ username: string }>('select username from public.profiles where id = $1', [id])
    expect(rows[0].username).toBe('alice')
    const prefs = await db.admin('select 1 from public.user_prefs where user_id = $1', [id])
    expect(prefs).toHaveLength(1)
  })

  it('todas as tabelas públicas têm RLS habilitado', async () => {
    const db = await createDb()
    const rows = await db.admin<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    )
    expect(rows).toEqual([])
  })
})
