-- ============================================================================
-- 0002_private_helpers.sql — Funções auxiliares (schema "private")
--
-- O schema "private" NÃO é exposto pela API REST (PostgREST expõe só "public"),
-- portanto o cliente não consegue chamá-las diretamente com IDs arbitrários.
-- Elas são usadas pelas políticas RLS e pelas funções RPC.
-- ============================================================================

create or replace function private.all_permissions() returns text[]
language sql immutable as $$
  select array[
    'administrator', 'manage_server', 'manage_roles', 'manage_channels',
    'create_invite', 'kick_members', 'ban_members', 'manage_messages',
    'send_messages', 'attach_files', 'add_reactions', 'mention_everyone',
    'connect_voice', 'speak', 'video', 'screen_share'
  ]
$$;

create or replace function private.require_uid() returns uuid
language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  return v;
end $$;

create or replace function private.is_active(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = p_user and disabled_at is null)
$$;

create or replace function private.is_member(p_server uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.members where server_id = p_server and user_id = p_user)
$$;

create or replace function private.is_owner(p_server uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.servers where id = p_server and owner_id = p_user)
$$;

-- IDs dos cargos de um membro (inclui o cargo padrão implícito).
create or replace function private.member_role_ids(p_server uuid, p_user uuid) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.roles where server_id = p_server and is_default
  union
  select role_id from public.member_roles where server_id = p_server and user_id = p_user
$$;

-- Verifica permissão no servidor. Dono = tudo; "administrator" = tudo.
create or replace function private.has_perm(p_server uuid, p_user uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select
    private.is_owner(p_server, p_user)
    or (
      private.is_member(p_server, p_user)
      and exists (
        select 1 from public.roles r
        where r.server_id = p_server
          and r.id in (select private.member_role_ids(p_server, p_user))
          and r.permissions && array['administrator', p_perm]
      )
    )
$$;

-- Posição hierárquica mais alta de um membro. Dono = infinito.
create or replace function private.top_position(p_server uuid, p_user uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when private.is_owner(p_server, p_user) then 2147483647
    else coalesce((
      select max(r.position) from public.roles r
      where r.server_id = p_server
        and r.id in (select private.member_role_ids(p_server, p_user))
    ), 0)
  end
$$;

-- O ator pode moderar o alvo? (nunca o dono, nunca alguém de nível igual/superior)
create or replace function private.can_manage_member(p_server uuid, p_actor uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_actor <> p_target
    and private.is_member(p_server, p_target)
    and not private.is_owner(p_server, p_target)
    and private.top_position(p_server, p_actor) > private.top_position(p_server, p_target)
$$;

create or replace function private.channel_server(p_channel uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select server_id from public.channels where id = p_channel
$$;

-- Resultado tri-estado da sobrescrita de canal (NULL = sem regra).
-- Regra do usuário vence; entre cargos, qualquer "permitir" vence "negar".
create or replace function private.channel_overwrite(p_channel uuid, p_user uuid, p_field text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  sid uuid;
  v boolean;
begin
  select server_id into sid from public.channels where id = p_channel;
  if sid is null then return null; end if;

  select case when p_field = 'view' then o.can_view else o.can_send end into v
    from public.channel_overwrites o
   where o.channel_id = p_channel and o.user_id = p_user;
  if v is not null then return v; end if;

  select bool_or(case when p_field = 'view' then o.can_view else o.can_send end) into v
    from public.channel_overwrites o
   where o.channel_id = p_channel
     and o.role_id in (select private.member_role_ids(sid, p_user));
  return v;
end $$;

create or replace function private.can_view_channel(p_channel uuid, p_user uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  sid uuid;
  priv boolean;
begin
  select server_id, is_private into sid, priv from public.channels where id = p_channel;
  if sid is null or p_user is null then return false; end if;
  if not private.is_member(sid, p_user) then return false; end if;
  if not private.is_active(p_user) then return false; end if;
  if private.has_perm(sid, p_user, 'manage_channels') then return true; end if;
  return coalesce(private.channel_overwrite(p_channel, p_user, 'view'), not priv);
end $$;

-- Pode enviar mensagens (canal de texto) ou entrar (canal de voz)?
create or replace function private.can_use_channel(p_channel uuid, p_user uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  sid uuid;
  k text;
begin
  select server_id, kind into sid, k from public.channels where id = p_channel;
  if sid is null then return false; end if;
  if not private.can_view_channel(p_channel, p_user) then return false; end if;
  if not private.has_perm(sid, p_user, case k when 'text' then 'send_messages' else 'connect_voice' end) then
    return false;
  end if;
  if private.has_perm(sid, p_user, 'administrator') then return true; end if;
  return coalesce(private.channel_overwrite(p_channel, p_user, 'send'), true);
end $$;

create or replace function private.is_dm_participant(p_dm uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.dm_participants where conversation_id = p_dm and user_id = p_user)
$$;

create or replace function private.is_blocked_between(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a)
  )
$$;

create or replace function private.are_friends(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = p_a and addressee_id = p_b) or (requester_id = p_b and addressee_id = p_a))
  )
$$;

-- Dois usuários compartilham algum contexto (servidor, amizade/pedido, DM)?
create or replace function private.shares_context(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_a = p_b
    or exists (
      select 1 from public.members m1 join public.members m2 on m1.server_id = m2.server_id
      where m1.user_id = p_a and m2.user_id = p_b)
    or exists (
      select 1 from public.friendships
      where (requester_id = p_a and addressee_id = p_b) or (requester_id = p_b and addressee_id = p_a))
    or exists (
      select 1 from public.dm_participants d1 join public.dm_participants d2 on d1.conversation_id = d2.conversation_id
      where d1.user_id = p_a and d2.user_id = p_b)
$$;

-- Pode ler a mensagem? (usado por anexos, reações e políticas)
create or replace function private.can_read_scope(p_channel uuid, p_dm uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_channel is not null then private.can_view_channel(p_channel, p_user)
    when p_dm is not null then private.is_dm_participant(p_dm, p_user)
    else false
  end
$$;

create or replace function private.can_read_message(p_message uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select private.can_read_scope(m.channel_id, m.dm_id, p_user)
    from public.messages m where m.id = p_message
  ), false)
$$;

-- Limitação de taxa: no máximo p_max eventos de p_action em p_seconds.
create or replace function private.rate_limit(p_user uuid, p_action text, p_max integer, p_seconds integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.rate_events where user_id = p_user and action = p_action and at < now() - interval '1 day';
  select count(*) into n from public.rate_events
   where user_id = p_user and action = p_action and at > now() - make_interval(secs => p_seconds);
  if n >= p_max then
    raise exception 'rate_limited' using errcode = 'P0429';
  end if;
  insert into public.rate_events (user_id, action) values (p_user, p_action);
end $$;

create or replace function private.log_mod(p_server uuid, p_actor uuid, p_target uuid, p_action text, p_details jsonb default '{}')
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.mod_logs (server_id, actor_id, target_id, action, details)
  values (p_server, p_actor, p_target, p_action, coalesce(p_details, '{}'::jsonb))
$$;

-- --------------------------------------------------- criação automática ---
-- Ao criar o usuário no Supabase Auth, cria perfil + preferências.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  base text;
  candidate text;
  n integer := 0;
begin
  base := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)), '[^a-zA-Z0-9_.]', '', 'g'));
  if char_length(base) < 2 then base := 'user' || base; end if;
  base := left(base, 28);
  candidate := base;
  while exists (select 1 from public.profiles where username = candidate) loop
    n := n + 1;
    candidate := left(base, 28) || floor(random() * 9000 + 1000)::int::text;
    exit when n > 20;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, candidate, left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), candidate), 32));
  insert into public.user_prefs (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
