-- ============================================================================
-- 0006_rpc_social.sql — Amigos, bloqueios, DMs, busca de usuários e conta
-- ============================================================================

-- Pública (anon) para validar o nome de usuário antes do cadastro.
create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select lower(btrim(coalesce(p_username, ''))) ~ '^[a-z0-9_.]{2,32}$'
     and not exists (select 1 from public.profiles where username = lower(btrim(p_username)))
$$;

create or replace function public.search_users(p_query text, p_limit integer default 10)
returns table (id uuid, username text, display_name text, avatar_path text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  p_query := lower(btrim(coalesce(p_query, '')));
  if char_length(p_query) < 2 then return; end if;
  perform private.rate_limit(uid, 'search_users', 30, 60);
  return query
    select p.id, p.username, p.display_name, p.avatar_path
    from profiles p
    where p.disabled_at is null and p.id <> uid
      and (p.username like replace(replace(p_query, '%', ''), '_', '\_') || '%'
           or lower(p.display_name) like replace(replace(p_query, '%', ''), '_', '\_') || '%')
      and not private.is_blocked_between(uid, p.id)
    order by p.username
    limit least(greatest(coalesce(p_limit, 10), 1), 20);
end $$;

create or replace function public.send_friend_request(p_username text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  target uuid;
  fr friendships;
begin
  if not private.is_active(uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.rate_limit(uid, 'friend_request', 15, 600);
  select id into target from profiles where username = lower(btrim(coalesce(p_username, ''))) and disabled_at is null;
  if target is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if target = uid then raise exception 'invalid_input' using errcode = '22023'; end if;
  if private.is_blocked_between(uid, target) then raise exception 'blocked' using errcode = '42501'; end if;

  select * into fr from friendships
   where (requester_id = uid and addressee_id = target) or (requester_id = target and addressee_id = uid);
  if found then
    if fr.status = 'accepted' then return 'already_friends'; end if;
    if fr.requester_id = target then  -- o outro já tinha pedido: aceita
      update friendships set status = 'accepted' where requester_id = target and addressee_id = uid;
      return 'accepted';
    end if;
    return 'already_pending';
  end if;
  if exists (select 1 from user_prefs where user_id = target and friend_requests = 'nobody') then
    raise exception 'requests_closed' using errcode = '42501';
  end if;
  insert into friendships (requester_id, addressee_id) values (uid, target);
  return 'sent';
end $$;

create or replace function public.respond_friend_request(p_requester uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if p_accept then
    update friendships set status = 'accepted'
     where requester_id = p_requester and addressee_id = uid and status = 'pending';
  else
    delete from friendships where requester_id = p_requester and addressee_id = uid and status = 'pending';
  end if;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- Remove amizade ou cancela pedido pendente enviado.
create or replace function public.remove_friend(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  delete from friendships
   where (requester_id = uid and addressee_id = p_user) or (requester_id = p_user and addressee_id = uid);
end $$;

create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if p_user = uid or not exists (select 1 from profiles where id = p_user) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  insert into blocks (blocker_id, blocked_id) values (uid, p_user) on conflict do nothing;
  delete from friendships
   where (requester_id = uid and addressee_id = p_user) or (requester_id = p_user and addressee_id = uid);
end $$;

create or replace function public.unblock_user(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  delete from blocks where blocker_id = uid and blocked_id = p_user;
end $$;

create or replace function public.open_dm(p_user uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  key text;
  cid uuid;
  pol text;
begin
  if p_user = uid or not private.is_active(uid) then raise exception 'invalid_input' using errcode = '22023'; end if;
  if not exists (select 1 from profiles where id = p_user and disabled_at is null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if private.is_blocked_between(uid, p_user) then raise exception 'blocked' using errcode = '42501'; end if;
  key := least(uid::text, p_user::text) || ':' || greatest(uid::text, p_user::text);
  select id into cid from dm_conversations where pair_key = key;
  if cid is not null then
    insert into dm_participants (conversation_id, user_id) values (cid, uid) on conflict do nothing;
    return cid;
  end if;
  -- Só pode iniciar uma conversa nova quem tem contexto compartilhado e respeita a política do alvo.
  if not private.shares_context(uid, p_user) then raise exception 'forbidden' using errcode = '42501'; end if;
  select dm_policy into pol from user_prefs where user_id = p_user;
  if coalesce(pol, 'everyone') = 'nobody' or (pol = 'friends' and not private.are_friends(uid, p_user)) then
    raise exception 'dm_closed' using errcode = '42501';
  end if;
  perform private.rate_limit(uid, 'open_dm', 20, 600);
  insert into dm_conversations (is_group, pair_key, created_by) values (false, key, uid) returning id into cid;
  insert into dm_participants (conversation_id, user_id) values (cid, uid), (cid, p_user);
  return cid;
end $$;

create or replace function public.create_group_dm(p_users uuid[], p_name text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  u uuid;
  cid uuid;
begin
  p_users := array(select distinct x from unnest(coalesce(p_users, '{}')) x where x <> uid);
  if coalesce(array_length(p_users, 1), 0) < 2 or array_length(p_users, 1) > 9 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  foreach u in array p_users loop
    if not private.are_friends(uid, u) then raise exception 'forbidden' using errcode = '42501'; end if;
  end loop;
  perform private.rate_limit(uid, 'create_group_dm', 10, 600);
  insert into dm_conversations (is_group, name, created_by) values (true, nullif(left(btrim(coalesce(p_name, '')), 100), ''), uid)
  returning id into cid;
  insert into dm_participants (conversation_id, user_id) values (cid, uid);
  insert into dm_participants (conversation_id, user_id) select cid, x from unnest(p_users) x;
  return cid;
end $$;

create or replace function public.leave_dm(p_dm uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  delete from dm_participants where conversation_id = p_dm and user_id = uid;
end $$;

-- --------------------------------------------------------------- conta ---
create or replace function public.deactivate_account() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  update profiles set disabled_at = now(), status_pref = 'invisible' where id = uid;
end $$;

create or replace function public.reactivate_account() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  update profiles set disabled_at = null where id = uid;
end $$;

-- Preparação para exclusão definitiva. Chamada SOMENTE pela Edge Function
-- "delete-account" com service_role (não é concedida a authenticated).
-- Servidores do usuário: transfere ao membro mais antigo ou apaga se vazio.
create or replace function public.prepare_account_deletion(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s record;
  heir uuid;
begin
  for s in select id from servers where owner_id = p_user loop
    select user_id into heir from members
     where server_id = s.id and user_id <> p_user order by joined_at limit 1;
    if heir is null then
      delete from servers where id = s.id;
    else
      update servers set owner_id = heir where id = s.id;
    end if;
  end loop;
  -- mensagens ficam com autor nulo ("Usuário excluído"); demais dados caem em cascata
end $$;
