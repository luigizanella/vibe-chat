import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Harness de testes do banco: sobe um PostgreSQL real (PGlite, WASM) em memória,
 * cria stubs mínimos do ambiente Supabase (auth, storage, realtime, roles) e aplica
 * TODAS as migrations de supabase/migrations. As políticas RLS e as RPCs testadas
 * são exatamente as do projeto.
 *
 * Limitação: valida SQL/RLS, não o PostgREST nem o Realtime em si.
 */

const STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

create schema realtime;
create table realtime.messages (id uuid primary key default gen_random_uuid(), topic text);
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
grant usage on schema realtime to authenticated;
grant select, insert on realtime.messages to authenticated;
grant execute on function realtime.topic() to authenticated;

create publication supabase_realtime;
grant usage on schema public to anon, authenticated, service_role;
`

export interface Db {
  pg: PGlite
  /** Cria usuário em auth.users (o trigger cria o perfil). */
  createUser(username: string): Promise<string>
  /** Executa uma consulta como o usuário (role authenticated + JWT sub). */
  as<T = Record<string, unknown>>(uid: string, sql: string, params?: unknown[]): Promise<T[]>
  /** Executa como anônimo. */
  anon<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** Executa como superusuário (postgres), ignorando RLS. */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

export async function createDb(): Promise<Db> {
  const pg = new PGlite()
  await pg.exec(STUBS)
  const dir = join(process.cwd(), 'supabase', 'migrations')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    try {
      await pg.exec(readFileSync(join(dir, f), 'utf8'))
    } catch (e) {
      throw new Error(`Falha ao aplicar migration ${f}: ${(e as Error).message}`, { cause: e })
    }
  }

  async function run<T>(role: string | null, uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    // sem transação explícita: SET LOCAL não persiste, então resetamos ao final
    try {
      if (role) {
        await pg.exec(`set role ${role}`)
        await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
      }
      const res = await pg.query<T>(sql, params)
      return res.rows
    } finally {
      await pg.exec(`reset role`)
      await pg.query(`select set_config('request.jwt.claim.sub', '', false)`)
    }
  }

  return {
    pg,
    async createUser(username: string) {
      const r = await pg.query<{ id: string }>(
        `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
        [`${username}@example.test`, JSON.stringify({ username })],
      )
      return r.rows[0].id
    },
    as: (uid, sql, params) => run('authenticated', uid, sql, params),
    anon: (sql, params) => run('anon', null, sql, params),
    admin: (sql, params) => run(null, null, sql, params),
  }
}

/** Retorna a mensagem de erro (ou null se não falhou). */
export async function errorOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p
    return null
  } catch (e) {
    return (e as Error).message
  }
}
