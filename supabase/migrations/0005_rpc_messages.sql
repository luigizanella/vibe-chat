-- ============================================================================
-- 0005_rpc_messages.sql — Mensagens, reações, fixadas, leitura e busca
-- Mensagens NÃO podem ser inseridas diretamente (sem política de INSERT):
-- tudo passa por send_message, que valida acesso, bloqueios, limites e menções.
-- ============================================================================

-- Extrai menções do texto: <@uuid> (usuário), <@&uuid> (cargo), @everyone.
create or replace function private.extract_user_mentions(p_content text) returns uuid[]
language sql immutable as $$
  select coalesce(array_agg(distinct (m[1])::uuid), '{}')
  from regexp_matches(p_content, '<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>', 'g') as m
$$;

create or replace function private.extract_role_mentions(p_content text) returns uuid[]
language sql immutable as $$
  select coalesce(array_agg(distinct (m[1])::uuid), '{}')
  from regexp_matches(p_content, '<@&([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>', 'g') as m
$$;

create or replace function public.send_message(
  p_id uuid, p_channel uuid, p_dm uuid, p_content text,
  p_reply_to uuid default null, p_attachments jsonb default '[]'::jsonb
) returns public.messages language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  sid uuid;
  msg messages;
  att jsonb;
  n_att integer;
  scope_prefix text;
  v_users uuid[];
  v_roles uuid[];
  v_everyone boolean := false;
begin
  if num_nonnulls(p_channel, p_dm) <> 1 then raise exception 'invalid_input' using errcode = '22023'; end if;
  if not private.is_active(uid) then raise exception 'forbidden' using errcode = '42501'; end if;

  -- reenvio idempotente (nova tentativa após falha de rede)
  select * into msg from messages where id = p_id;
  if found then
    if msg.author_id = uid then return msg; end if;
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  p_content := btrim(coalesce(p_content, ''));
  p_attachments := coalesce(p_attachments, '[]'::jsonb);
  if jsonb_typeof(p_attachments) <> 'array' then raise exception 'invalid_input' using errcode = '22023'; end if;
  n_att := jsonb_array_length(p_attachments);
  if char_length(p_content) > 4000 or n_att > 10 or (p_content = '' and n_att = 0) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  perform private.rate_limit(uid, 'send_message', 15, 10);

  if p_channel is not null then
    sid := private.channel_server(p_channel);
    if sid is null or not private.can_use_channel(p_channel, uid)
       or (select kind from channels where id = p_channel) <> 'text' then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if n_att > 0 and not private.has_perm(sid, uid, 'attach_files') then raise exception 'forbidden' using errcode = '42501'; end if;
    scope_prefix := 'c/' || p_channel::text || '/' || uid::text || '/';
    if p_content ~ '@everyone' and private.has_perm(sid, uid, 'mention_everyone') then v_everyone := true; end if;
    select coalesce(array_agg(u), '{}') into v_users
      from unnest(private.extract_user_mentions(p_content)) u
     where private.can_view_channel(p_channel, u);
    select coalesce(array_agg(r.id), '{}') into v_roles
      from unnest(private.extract_role_mentions(p_content)) rid join roles r on r.id = rid and r.server_id = sid;
  else
    if not private.is_dm_participant(p_dm, uid) then raise exception 'forbidden' using errcode = '42501'; end if;
    if exists (
      select 1 from dm_participants dp
      where dp.conversation_id = p_dm and dp.user_id <> uid and private.is_blocked_between(uid, dp.user_id)
    ) and not (select is_group from dm_conversations where id = p_dm) then
      raise exception 'blocked' using errcode = '42501';
    end if;
    scope_prefix := 'd/' || p_dm::text || '/' || uid::text || '/';
    select coalesce(array_agg(u), '{}') into v_users
      from unnest(private.extract_user_mentions(p_content)) u
     where private.is_dm_participant(p_dm, u);
    v_roles := '{}';
  end if;

  if p_reply_to is not null and not exists (
    select 1 from messages where id = p_reply_to and channel_id is not distinct from p_channel and dm_id is not distinct from p_dm
  ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  insert into messages (id, channel_id, dm_id, author_id, content, reply_to_id, mention_user_ids, mention_role_ids, mention_everyone)
  values (p_id, p_channel, p_dm, uid, p_content, p_reply_to, v_users, v_roles, v_everyone)
  returning * into msg;

  for att in select * from jsonb_array_elements(p_attachments) loop
    if (att ->> 'path') is null or left(att ->> 'path', char_length(scope_prefix)) <> scope_prefix
       or (att ->> 'path') like '%..%' or char_length(coalesce(att ->> 'name', '')) not between 1 and 255
       or coalesce((att ->> 'size')::bigint, -1) not between 0 and 26214400 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    insert into attachments (message_id, storage_path, file_name, content_type, size_bytes)
    values (msg.id, att ->> 'path', att ->> 'name', coalesce(nullif(att ->> 'type', ''), 'application/octet-stream'), (att ->> 'size')::bigint);
  end loop;

  if p_dm is not null then update dm_conversations set last_message_at = msg.created_at where id = p_dm; end if;

  -- quem envia já leu até aqui
  if p_channel is not null then
    insert into read_states (user_id, channel_id, last_read_at) values (uid, p_channel, msg.created_at)
    on conflict (user_id, channel_id) where channel_id is not null do update set last_read_at = excluded.last_read_at;
  else
    insert into read_states (user_id, dm_id, last_read_at) values (uid, p_dm, msg.created_at)
    on conflict (user_id, dm_id) where dm_id is not null do update set last_read_at = excluded.last_read_at;
  end if;
  return msg;
end $$;

create or replace function public.edit_message(p_id uuid, p_content text) returns public.messages
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  msg messages;
  sid uuid;
  v_users uuid[];
begin
  select * into msg from messages where id = p_id;
  if not found or msg.author_id is distinct from uid then raise exception 'forbidden' using errcode = '42501'; end if;
  if not private.can_read_scope(msg.channel_id, msg.dm_id, uid) or not private.is_active(uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  p_content := btrim(coalesce(p_content, ''));
  if char_length(p_content) > 4000 or (p_content = '' and not exists (select 1 from attachments where message_id = p_id)) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  perform private.rate_limit(uid, 'edit_message', 20, 30);

  if msg.channel_id is not null then
    sid := private.channel_server(msg.channel_id);
    select coalesce(array_agg(u), '{}') into v_users from unnest(private.extract_user_mentions(p_content)) u
     where private.can_view_channel(msg.channel_id, u);
  else
    select coalesce(array_agg(u), '{}') into v_users from unnest(private.extract_user_mentions(p_content)) u
     where private.is_dm_participant(msg.dm_id, u);
  end if;

  update messages set
    content = p_content,
    edited_at = now(),
    mention_user_ids = v_users,
    mention_role_ids = case when msg.channel_id is null then '{}' else
      coalesce((select array_agg(r.id) from unnest(private.extract_role_mentions(p_content)) rid
                join roles r on r.id = rid and r.server_id = sid), '{}') end,
    mention_everyone = msg.mention_everyone and p_content ~ '@everyone'
  where id = p_id returning * into msg;
  return msg;
end $$;

create or replace function public.delete_message(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  msg messages;
begin
  select * into msg from messages where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not private.can_read_scope(msg.channel_id, msg.dm_id, uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if msg.author_id is distinct from uid then
    if msg.channel_id is null
       or not private.has_perm(private.channel_server(msg.channel_id), uid, 'manage_messages') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    perform private.log_mod(private.channel_server(msg.channel_id), uid, msg.author_id, 'message_deleted',
                            jsonb_build_object('channel', msg.channel_id));
  end if;
  delete from messages where id = p_id;
end $$;

create or replace function public.toggle_reaction(p_id uuid, p_emoji text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  msg messages;
begin
  select * into msg from messages where id = p_id;
  if not found or not private.can_read_scope(msg.channel_id, msg.dm_id, uid) or not private.is_active(uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  p_emoji := btrim(coalesce(p_emoji, ''));
  if char_length(p_emoji) not between 1 and 32 then raise exception 'invalid_input' using errcode = '22023'; end if;
  if exists (select 1 from reactions where message_id = p_id and user_id = uid and emoji = p_emoji) then
    delete from reactions where message_id = p_id and user_id = uid and emoji = p_emoji;
    return false;
  end if;
  if msg.channel_id is not null and not private.has_perm(private.channel_server(msg.channel_id), uid, 'add_reactions') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.rate_limit(uid, 'reaction', 30, 10);
  if (select count(distinct emoji) from reactions where message_id = p_id) >= 20 then
    raise exception 'limit_reached' using errcode = '22023';
  end if;
  insert into reactions (message_id, user_id, emoji) values (p_id, uid, p_emoji);
  return true;
end $$;

create or replace function public.set_pinned(p_id uuid, p_pinned boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  msg messages;
begin
  select * into msg from messages where id = p_id;
  if not found or not private.can_read_scope(msg.channel_id, msg.dm_id, uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if msg.channel_id is not null and not private.has_perm(private.channel_server(msg.channel_id), uid, 'manage_messages') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_pinned and (select count(*) from messages
                    where channel_id is not distinct from msg.channel_id and dm_id is not distinct from msg.dm_id
                      and pinned_at is not null) >= 50 then
    raise exception 'limit_reached' using errcode = '22023';
  end if;
  update messages set pinned_at = case when p_pinned then now() end, pinned_by = case when p_pinned then uid end
   where id = p_id;
end $$;

-- ------------------------------------------------------- não lidas / leitura ---
create or replace function public.mark_read(p_channel uuid default null, p_dm uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if num_nonnulls(p_channel, p_dm) <> 1 then raise exception 'invalid_input' using errcode = '22023'; end if;
  if not private.can_read_scope(p_channel, p_dm, uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_channel is not null then
    insert into read_states (user_id, channel_id, last_read_at) values (uid, p_channel, now())
    on conflict (user_id, channel_id) where channel_id is not null do update set last_read_at = now();
  else
    insert into read_states (user_id, dm_id, last_read_at) values (uid, p_dm, now())
    on conflict (user_id, dm_id) where dm_id is not null do update set last_read_at = now();
  end if;
end $$;

-- Contadores de não lidas e menções por canal / conversa (limite de 100 por item).
create or replace function public.unread_summary()
returns table (channel_id uuid, dm_id uuid, unread_count integer, mention_count integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  return query
  with my_channels as (
    select c.id as cid, c.server_id as sid, m.joined_at
    from channels c join members m on m.server_id = c.server_id and m.user_id = uid
    where c.kind = 'text' and private.can_view_channel(c.id, uid)
  ),
  chan as (
    select mc.cid, mc.sid,
      (select count(*)::int from (
         select 1 from messages x
         where x.channel_id = mc.cid and x.author_id is distinct from uid
           and x.created_at > coalesce((select rs.last_read_at from read_states rs where rs.user_id = uid and rs.channel_id = mc.cid), mc.joined_at)
         limit 100) q) as unread,
      (select count(*)::int from (
         select 1 from messages x
         where x.channel_id = mc.cid and x.author_id is distinct from uid
           and x.created_at > coalesce((select rs.last_read_at from read_states rs where rs.user_id = uid and rs.channel_id = mc.cid), mc.joined_at)
           and (uid = any (x.mention_user_ids) or x.mention_everyone
                or x.mention_role_ids && array(select private.member_role_ids(mc.sid, uid)))
         limit 100) q) as mentions
    from my_channels mc
  ),
  dms as (
    select dp.conversation_id as did,
      (select count(*)::int from (
         select 1 from messages x
         where x.dm_id = dp.conversation_id and x.author_id is distinct from uid
           and x.created_at > coalesce((select rs.last_read_at from read_states rs where rs.user_id = uid and rs.dm_id = dp.conversation_id), dp.joined_at)
         limit 100) q) as unread,
      (select count(*)::int from (
         select 1 from messages x
         where x.dm_id = dp.conversation_id and x.author_id is distinct from uid
           and x.created_at > coalesce((select rs.last_read_at from read_states rs where rs.user_id = uid and rs.dm_id = dp.conversation_id), dp.joined_at)
           and uid = any (x.mention_user_ids)
         limit 100) q) as mentions
    from dm_participants dp where dp.user_id = uid
  )
  select chan.cid, null::uuid, chan.unread, chan.mentions from chan where chan.unread > 0
  union all
  select null::uuid, dms.did, dms.unread, dms.mentions from dms where dms.unread > 0;
end $$;

-- Busca (SECURITY INVOKER de propósito: a RLS de messages garante o isolamento).
create or replace function public.search_messages(
  p_query text, p_server uuid default null, p_channel uuid default null, p_dm uuid default null,
  p_limit integer default 25, p_before timestamptz default null
) returns setof public.messages
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare pat text;
begin
  p_query := btrim(coalesce(p_query, ''));
  if char_length(p_query) < 2 or char_length(p_query) > 100 then return; end if;
  pat := '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select m.* from messages m
    where m.content ilike pat
      and (p_channel is null or m.channel_id = p_channel)
      and (p_dm is null or m.dm_id = p_dm)
      and (p_server is null or m.channel_id in (select id from channels where server_id = p_server))
      and (p_before is null or m.created_at < p_before)
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 25), 1), 50);
end $$;
