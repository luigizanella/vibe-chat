-- ============================================================================
-- 0011_roles_phase2.sql — Cargos: exibir separadamente, reordenação, membros no
-- cargo, correção da atribuição de cargos pelo dono, e marcação de bots.
-- ============================================================================

alter table public.roles add column if not exists hoist boolean not null default true;
update public.roles set hoist = false where is_default;

-- Bots (ex.: "Vibe Beats"). Só o servidor (service_role/migrations) define: sem GRANT de coluna ao cliente.
alter table public.profiles add column if not exists is_bot boolean not null default false;

-- ------------------------------------------------ regra única de atribuição ---
-- Pode o ator conceder/retirar o cargo ao alvo?
--  * dono: sempre (inclusive em si mesmo);
--  * demais: só cargos estritamente abaixo do próprio nível, em quem está abaixo de si;
--    em si mesmo: conceder exige possuir todas as permissões do cargo (sem brecha de promoção);
--    retirar de si mesmo é permitido para cargos abaixo do próprio nível.
create or replace function private.can_assign_role(p_server uuid, p_actor uuid, p_target uuid, p_role uuid, p_grant boolean)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r roles;
begin
  select * into r from roles where id = p_role and server_id = p_server;
  if not found or r.is_default then return false; end if;
  if not private.is_member(p_server, p_target) then return false; end if;
  if private.is_owner(p_server, p_actor) then return true; end if;
  if not private.has_perm(p_server, p_actor, 'manage_roles') then return false; end if;
  if r.position >= private.top_position(p_server, p_actor) then return false; end if;
  if p_target = p_actor then
    return (not p_grant) or private.actor_has_all_perms(p_server, p_actor, r.permissions);
  end if;
  return private.can_manage_member(p_server, p_actor, p_target);
end $$;

create or replace function public.set_member_role(p_server uuid, p_user uuid, p_role uuid, p_grant boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if not exists (select 1 from roles where id = p_role and server_id = p_server) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not private.can_assign_role(p_server, uid, p_user, p_role, p_grant) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_grant then
    insert into member_roles (server_id, user_id, role_id) values (p_server, p_user, p_role) on conflict do nothing;
  else
    delete from member_roles where server_id = p_server and user_id = p_user and role_id = p_role;
  end if;
  perform private.log_mod(p_server, uid, p_user, case when p_grant then 'role_granted' else 'role_revoked' end,
                          jsonb_build_object('role', p_role));
end $$;

-- ------------------------------------------------------ criar / editar ---
drop function if exists public.create_role(uuid, text, text, text[]);
create or replace function public.create_role(
  p_server uuid, p_name text, p_color text default '#99aab5', p_permissions text[] default '{}',
  p_hoist boolean default true, p_members uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  rid uuid;
  u uuid;
begin
  if not private.has_perm(p_server, uid, 'manage_roles') then raise exception 'forbidden' using errcode = '42501'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 50 or p_color !~ '^#[0-9a-fA-F]{6}$'
     or not (coalesce(p_permissions, '{}') <@ private.all_permissions())
     or coalesce(array_length(p_members, 1), 0) > 200 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not private.actor_has_all_perms(p_server, uid, p_permissions) then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select count(*) from roles where server_id = p_server) >= 50 then raise exception 'limit_reached' using errcode = '22023'; end if;
  insert into roles (server_id, name, color, position, permissions, hoist)
  values (p_server, p_name, p_color, 1, coalesce(p_permissions, '{}'), coalesce(p_hoist, true)) returning id into rid;
  foreach u in array coalesce(p_members, '{}') loop
    if not private.can_assign_role(p_server, uid, u, rid, true) then raise exception 'forbidden' using errcode = '42501'; end if;
    insert into member_roles (server_id, user_id, role_id) values (p_server, u, rid) on conflict do nothing;
  end loop;
  perform private.log_mod(p_server, uid, null, 'role_created', jsonb_build_object('role', rid));
  return rid;
end $$;

drop function if exists public.update_role(uuid, text, text, text[], integer);
create or replace function public.update_role(
  p_role uuid, p_name text default null, p_color text default null,
  p_permissions text[] default null, p_position integer default null, p_hoist boolean default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  r roles;
  actor_top integer;
begin
  select * into r from roles where id = p_role;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not private.has_perm(r.server_id, uid, 'manage_roles') then raise exception 'forbidden' using errcode = '42501'; end if;
  actor_top := private.top_position(r.server_id, uid);
  if r.position >= actor_top then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_name is not null and char_length(btrim(p_name)) not between 1 and 50 then raise exception 'invalid_input' using errcode = '22023'; end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'invalid_input' using errcode = '22023'; end if;
  if p_permissions is not null then
    if not (p_permissions <@ private.all_permissions()) then raise exception 'invalid_input' using errcode = '22023'; end if;
    if not private.actor_has_all_perms(r.server_id, uid, p_permissions) then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if p_position is not null then
    if r.is_default or p_position < 1 or p_position >= actor_top then raise exception 'invalid_input' using errcode = '22023'; end if;
  end if;
  update roles set
    name = coalesce(btrim(p_name), name),
    color = coalesce(p_color, color),
    permissions = coalesce(p_permissions, permissions),
    position = coalesce(p_position, position),
    hoist = case when r.is_default then false else coalesce(p_hoist, hoist) end
  where id = p_role;
  perform private.log_mod(r.server_id, uid, null, 'role_updated', jsonb_build_object('role', p_role));
end $$;

-- ------------------------------------------------- reordenar (arrastar) ---
-- p_order: TODOS os cargos não padrão do servidor, do mais alto para o mais baixo.
-- Quem não é dono só pode reposicionar cargos estritamente abaixo do seu nível: os cargos
-- em/acima do nível do ator precisam permanecer, no topo, na mesma ordem relativa.
create or replace function public.reorder_roles(p_server uuid, p_order uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  n integer := coalesce(array_length(p_order, 1), 0);
  actor_top integer;
  locked uuid[];
  prefix uuid[];
  i integer;
begin
  if not private.has_perm(p_server, uid, 'manage_roles') then raise exception 'forbidden' using errcode = '42501'; end if;
  if n <> (select count(*) from roles where server_id = p_server and not is_default)
     or (select count(distinct x) from unnest(p_order) x) <> n
     or exists (select 1 from unnest(p_order) x where not exists (select 1 from roles where id = x and server_id = p_server and not is_default)) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  actor_top := private.top_position(p_server, uid);
  select coalesce(array_agg(id order by position desc), '{}') into locked
    from roles where server_id = p_server and not is_default and position >= actor_top;
  if coalesce(array_length(locked, 1), 0) > 0 then
    prefix := p_order[1:array_length(locked, 1)];
    -- mesmo conjunto no topo...
    if not (prefix <@ locked and locked <@ prefix) then raise exception 'forbidden' using errcode = '42501'; end if;
    -- ...e sem inverter cargos de posições diferentes
    for i in 2..array_length(prefix, 1) loop
      if (select position from roles where id = prefix[i]) > (select position from roles where id = prefix[i - 1]) then
        raise exception 'forbidden' using errcode = '42501';
      end if;
    end loop;
  end if;

  for i in 1..n loop
    update roles set position = (n - i + 1) * 10 where id = p_order[i];
  end loop;
  perform private.log_mod(p_server, uid, null, 'roles_reordered');
end $$;

revoke all on function public.create_role(uuid, text, text, text[], boolean, uuid[]) from public, anon;
revoke all on function public.update_role(uuid, text, text, text[], integer, boolean) from public, anon;
revoke all on function public.reorder_roles(uuid, uuid[]) from public, anon;
grant execute on function public.create_role(uuid, text, text, text[], boolean, uuid[]) to authenticated;
grant execute on function public.update_role(uuid, text, text, text[], integer, boolean) to authenticated;
grant execute on function public.reorder_roles(uuid, uuid[]) to authenticated;
