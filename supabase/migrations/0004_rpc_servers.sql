-- ============================================================================
-- 0004_rpc_servers.sql — Servidores, convites, cargos, canais e moderação
-- Todas as funções validam auth.uid(), permissões e hierarquia no banco.
-- Erros: 'forbidden' (42501), 'not_found' (P0002), 'invalid_input' (22023),
--        'rate_limited' (P0429), 'banned', 'invite_invalid'.
-- ============================================================================

-- ------------------------------------------------------------- servidores ---
create or replace function public.create_server(p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  sid uuid;
  cat_text uuid;
  cat_voice uuid;
  admin_role uuid;
begin
  if not private.is_active(uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 100 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  perform private.rate_limit(uid, 'create_server', 5, 3600);

  insert into servers (name, owner_id) values (p_name, uid) returning id into sid;

  insert into roles (server_id, name, color, position, permissions, is_default)
  values (sid, 'Membro', '#99aab5', 0,
          array['send_messages','attach_files','add_reactions','create_invite','connect_voice','speak','video','screen_share'], true);
  insert into roles (server_id, name, color, position, permissions)
  values (sid, 'Moderador', '#3ba55d', 50,
          array['kick_members','ban_members','manage_messages','mention_everyone']);
  insert into roles (server_id, name, color, position, permissions)
  values (sid, 'Administrador', '#ed4245', 100, array['administrator'])
  returning id into admin_role;

  insert into members (server_id, user_id) values (sid, uid);

  insert into categories (server_id, name, position) values (sid, 'Canais de texto', 0) returning id into cat_text;
  insert into categories (server_id, name, position) values (sid, 'Canais de voz', 1) returning id into cat_voice;
  insert into channels (server_id, category_id, name, kind, position) values (sid, cat_text, 'geral', 'text', 0);
  insert into channels (server_id, category_id, name, kind, position) values (sid, cat_voice, 'Voz geral', 'voice', 0);

  perform private.log_mod(sid, uid, null, 'server_created');
  return sid;
end $$;

create or replace function public.update_server(
  p_server uuid, p_name text default null, p_icon_path text default null, p_clear_icon boolean default false
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if not private.has_perm(p_server, uid, 'manage_server') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_name is not null then
    p_name := btrim(p_name);
    if char_length(p_name) not between 1 and 100 then raise exception 'invalid_input' using errcode = '22023'; end if;
  end if;
  if p_icon_path is not null and p_icon_path not like ('servers/' || p_server::text || '/%') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update servers set
    name = coalesce(p_name, name),
    icon_path = case when p_clear_icon then null else coalesce(p_icon_path, icon_path) end
  where id = p_server;
  perform private.log_mod(p_server, uid, null, 'server_updated');
end $$;

create or replace function public.delete_server(p_server uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if not private.is_owner(p_server, uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from servers where id = p_server;  -- cascata: cargos, canais, mensagens, convites...
end $$;

create or replace function public.leave_server(p_server uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if private.is_owner(p_server, uid) then
    raise exception 'owner_cannot_leave' using errcode = '42501';
  end if;
  delete from members where server_id = p_server and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.transfer_ownership(p_server uuid, p_new_owner uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if not private.is_owner(p_server, uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_new_owner = uid or not private.is_member(p_server, p_new_owner) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update servers set owner_id = p_new_owner where id = p_server;
  perform private.log_mod(p_server, uid, p_new_owner, 'ownership_transferred');
end $$;

create or replace function public.set_nickname(p_server uuid, p_nickname text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  p_nickname := nullif(btrim(coalesce(p_nickname, '')), '');
  if p_nickname is not null and char_length(p_nickname) > 32 then raise exception 'invalid_input' using errcode = '22023'; end if;
  update members set nickname = p_nickname where server_id = p_server and user_id = uid;
end $$;

-- ---------------------------------------------------------------- convites ---
create or replace function public.create_invite(p_server uuid, p_expires_seconds integer default 604800, p_max_uses integer default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  v_code text;
begin
  if not private.has_perm(p_server, uid, 'create_invite') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_max_uses is not null and p_max_uses < 1 then raise exception 'invalid_input' using errcode = '22023'; end if;
  if p_expires_seconds is not null and (p_expires_seconds < 60 or p_expires_seconds > 31536000) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  perform private.rate_limit(uid, 'create_invite', 20, 3600);
  v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  insert into invites (code, server_id, created_by, expires_at, max_uses)
  values (v_code, p_server, uid,
          case when p_expires_seconds is null then null else now() + make_interval(secs => p_expires_seconds) end,
          p_max_uses);
  return v_code;
end $$;

create or replace function public.revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  inv invites;
begin
  select * into inv from invites where code = p_code;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if inv.created_by is distinct from uid and not private.has_perm(inv.server_id, uid, 'manage_server') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update invites set revoked_at = now() where code = p_code and revoked_at is null;
end $$;

create or replace function public.preview_invite(p_code text)
returns table (server_id uuid, name text, icon_path text, member_count bigint, valid boolean, already_member boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  perform private.rate_limit(uid, 'preview_invite', 30, 60);
  return query
    select s.id, s.name, s.icon_path,
           (select count(*) from members m where m.server_id = s.id),
           (i.revoked_at is null and (i.expires_at is null or i.expires_at > now())
              and (i.max_uses is null or i.uses < i.max_uses)
              and not exists (select 1 from bans b where b.server_id = s.id and b.user_id = uid)),
           private.is_member(s.id, uid)
    from invites i join servers s on s.id = i.server_id
    where i.code = p_code;
end $$;

create or replace function public.join_server(p_code text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  inv invites;
begin
  if not private.is_active(uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.rate_limit(uid, 'join_server', 15, 600);
  select * into inv from invites where code = p_code for update;
  if not found or inv.revoked_at is not null
     or (inv.expires_at is not null and inv.expires_at <= now())
     or (inv.max_uses is not null and inv.uses >= inv.max_uses) then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  if exists (select 1 from bans where server_id = inv.server_id and user_id = uid) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if private.is_member(inv.server_id, uid) then return inv.server_id; end if;
  insert into members (server_id, user_id) values (inv.server_id, uid);
  update invites set uses = uses + 1 where code = p_code;
  return inv.server_id;
end $$;

-- ----------------------------------------------------------------- cargos ---
-- O ator só concede permissões que ele próprio possui (dono/admin: todas).
create or replace function private.actor_has_all_perms(p_server uuid, p_actor uuid, p_perms text[]) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p text;
begin
  if private.has_perm(p_server, p_actor, 'administrator') then return true; end if;
  foreach p in array coalesce(p_perms, '{}') loop
    if not private.has_perm(p_server, p_actor, p) then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.create_role(p_server uuid, p_name text, p_color text default '#99aab5', p_permissions text[] default '{}')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  rid uuid;
begin
  if not private.has_perm(p_server, uid, 'manage_roles') then raise exception 'forbidden' using errcode = '42501'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 50 or p_color !~ '^#[0-9a-fA-F]{6}$'
     or not (coalesce(p_permissions, '{}') <@ private.all_permissions()) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not private.actor_has_all_perms(p_server, uid, p_permissions) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into roles (server_id, name, color, position, permissions)
  values (p_server, p_name, p_color, 1, coalesce(p_permissions, '{}')) returning id into rid;
  perform private.log_mod(p_server, uid, null, 'role_created', jsonb_build_object('role', rid));
  return rid;
end $$;

create or replace function public.update_role(
  p_role uuid, p_name text default null, p_color text default null,
  p_permissions text[] default null, p_position integer default null
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
  -- não pode editar cargos de nível igual ou superior ao seu
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
    position = coalesce(p_position, position)
  where id = p_role;
  perform private.log_mod(r.server_id, uid, null, 'role_updated', jsonb_build_object('role', p_role));
end $$;

create or replace function public.delete_role(p_role uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  r roles;
begin
  select * into r from roles where id = p_role;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.is_default then raise exception 'invalid_input' using errcode = '22023'; end if;
  if not private.has_perm(r.server_id, uid, 'manage_roles') or r.position >= private.top_position(r.server_id, uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from roles where id = p_role;
  perform private.log_mod(r.server_id, uid, null, 'role_deleted', jsonb_build_object('name', r.name));
end $$;

create or replace function public.set_member_role(p_server uuid, p_user uuid, p_role uuid, p_grant boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  r roles;
begin
  select * into r from roles where id = p_role and server_id = p_server;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.is_default then raise exception 'invalid_input' using errcode = '22023'; end if;
  if not private.has_perm(p_server, uid, 'manage_roles') then raise exception 'forbidden' using errcode = '42501'; end if;
  if r.position >= private.top_position(p_server, uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  -- alterar cargos de outra pessoa exige hierarquia superior; em si mesmo só remover
  if p_user = uid then
    if p_grant then raise exception 'forbidden' using errcode = '42501'; end if;
  elsif not private.can_manage_member(p_server, uid, p_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.is_member(p_server, p_user) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_grant then
    insert into member_roles (server_id, user_id, role_id) values (p_server, p_user, p_role) on conflict do nothing;
  else
    delete from member_roles where server_id = p_server and user_id = p_user and role_id = p_role;
  end if;
  perform private.log_mod(p_server, uid, p_user, case when p_grant then 'role_granted' else 'role_revoked' end,
                          jsonb_build_object('role', p_role));
end $$;

-- --------------------------------------------------------------- moderação ---
create or replace function public.kick_member(p_server uuid, p_user uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if not private.has_perm(p_server, uid, 'kick_members') or not private.can_manage_member(p_server, uid, p_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from members where server_id = p_server and user_id = p_user;
  perform private.log_mod(p_server, uid, p_user, 'kick', jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)));
end $$;

create or replace function public.ban_member(p_server uuid, p_user uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if not private.has_perm(p_server, uid, 'ban_members') or not private.can_manage_member(p_server, uid, p_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from members where server_id = p_server and user_id = p_user;
  insert into bans (server_id, user_id, banned_by, reason)
  values (p_server, p_user, uid, left(coalesce(p_reason, ''), 200))
  on conflict (server_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by;
  perform private.log_mod(p_server, uid, p_user, 'ban', jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)));
end $$;

create or replace function public.unban_member(p_server uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if not private.has_perm(p_server, uid, 'ban_members') then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from bans where server_id = p_server and user_id = p_user;
  perform private.log_mod(p_server, uid, p_user, 'unban');
end $$;

-- ---------------------------------------------------- categorias e canais ---
create or replace function public.create_category(p_server uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid(); cid uuid;
begin
  if not private.has_perm(p_server, uid, 'manage_channels') then raise exception 'forbidden' using errcode = '42501'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 50 then raise exception 'invalid_input' using errcode = '22023'; end if;
  insert into categories (server_id, name, position)
  values (p_server, p_name, coalesce((select max(position) + 1 from categories where server_id = p_server), 0))
  returning id into cid;
  return cid;
end $$;

create or replace function public.update_category(p_category uuid, p_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid(); sid uuid;
begin
  select server_id into sid from categories where id = p_category;
  if sid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not private.has_perm(sid, uid, 'manage_channels') then raise exception 'forbidden' using errcode = '42501'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 50 then raise exception 'invalid_input' using errcode = '22023'; end if;
  update categories set name = p_name where id = p_category;
end $$;

create or replace function public.delete_category(p_category uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid(); sid uuid;
begin
  select server_id into sid from categories where id = p_category;
  if sid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not private.has_perm(sid, uid, 'manage_channels') then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from categories where id = p_category;  -- canais ficam sem categoria (ON DELETE SET NULL)
end $$;

create or replace function public.create_channel(
  p_server uuid, p_name text, p_kind text default 'text', p_category uuid default null, p_private boolean default false
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid(); cid uuid;
begin
  if not private.has_perm(p_server, uid, 'manage_channels') then raise exception 'forbidden' using errcode = '42501'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 100 or p_kind not in ('text', 'voice') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_category is not null and not exists (select 1 from categories where id = p_category and server_id = p_server) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if (select count(*) from channels where server_id = p_server) >= 200 then raise exception 'limit_reached' using errcode = '22023'; end if;
  insert into channels (server_id, category_id, name, kind, is_private, position)
  values (p_server, p_category, case when p_kind = 'text' then lower(replace(p_name, ' ', '-')) else p_name end,
          p_kind, coalesce(p_private, false),
          coalesce((select max(position) + 1 from channels where server_id = p_server and category_id is not distinct from p_category), 0))
  returning id into cid;
  return cid;
end $$;

create or replace function public.update_channel(
  p_channel uuid, p_name text default null, p_topic text default null, p_private boolean default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid(); sid uuid;
begin
  sid := private.channel_server(p_channel);
  if sid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not private.has_perm(sid, uid, 'manage_channels') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_name is not null and char_length(btrim(p_name)) not between 1 and 100 then raise exception 'invalid_input' using errcode = '22023'; end if;
  if p_topic is not null and char_length(p_topic) > 1024 then raise exception 'invalid_input' using errcode = '22023'; end if;
  update channels set
    name = coalesce(btrim(p_name), name),
    topic = coalesce(p_topic, topic),
    is_private = coalesce(p_private, is_private)
  where id = p_channel;
end $$;

create or replace function public.delete_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid(); sid uuid;
begin
  sid := private.channel_server(p_channel);
  if sid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not private.has_perm(sid, uid, 'manage_channels') then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from channels where id = p_channel;  -- cascata: mensagens, anexos, reações, leitura, prefs
end $$;

-- Reordenação em lote (arrastar e soltar).
--   p_categories: [{"id": uuid, "position": int}]
--   p_channels:   [{"id": uuid, "category_id": uuid|null, "position": int}]
create or replace function public.reorder_layout(p_server uuid, p_categories jsonb, p_channels jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  item jsonb;
begin
  if not private.has_perm(p_server, uid, 'manage_channels') then raise exception 'forbidden' using errcode = '42501'; end if;
  for item in select * from jsonb_array_elements(coalesce(p_categories, '[]'::jsonb)) loop
    update categories set position = (item ->> 'position')::int
     where id = (item ->> 'id')::uuid and server_id = p_server;
  end loop;
  for item in select * from jsonb_array_elements(coalesce(p_channels, '[]'::jsonb)) loop
    if (item ->> 'category_id') is not null
       and not exists (select 1 from categories where id = (item ->> 'category_id')::uuid and server_id = p_server) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    update channels set position = (item ->> 'position')::int, category_id = nullif(item ->> 'category_id', '')::uuid
     where id = (item ->> 'id')::uuid and server_id = p_server;
  end loop;
end $$;

create or replace function public.set_channel_overwrite(
  p_channel uuid, p_role uuid default null, p_user uuid default null,
  p_can_view boolean default null, p_can_send boolean default null
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid(); sid uuid;
begin
  sid := private.channel_server(p_channel);
  if sid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not private.has_perm(sid, uid, 'manage_channels') then raise exception 'forbidden' using errcode = '42501'; end if;
  if num_nonnulls(p_role, p_user) <> 1 then raise exception 'invalid_input' using errcode = '22023'; end if;
  if p_role is not null and not exists (select 1 from roles where id = p_role and server_id = sid) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_user is not null and not private.is_member(sid, p_user) then raise exception 'invalid_input' using errcode = '22023'; end if;

  if p_can_view is null and p_can_send is null then
    delete from channel_overwrites where channel_id = p_channel and role_id is not distinct from p_role and user_id is not distinct from p_user;
  elsif p_role is not null then
    insert into channel_overwrites (channel_id, role_id, can_view, can_send) values (p_channel, p_role, p_can_view, p_can_send)
    on conflict (channel_id, role_id) where role_id is not null do update set can_view = excluded.can_view, can_send = excluded.can_send;
  else
    insert into channel_overwrites (channel_id, user_id, can_view, can_send) values (p_channel, p_user, p_can_view, p_can_send)
    on conflict (channel_id, user_id) where user_id is not null do update set can_view = excluded.can_view, can_send = excluded.can_send;
  end if;
end $$;
