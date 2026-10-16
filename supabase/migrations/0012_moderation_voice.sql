-- ============================================================================
-- 0012_moderation_voice.sql — Castigo (timeout) e moderação de voz
--   * novas permissões: moderate_members, mute_members, deafen_members, move_members
--   * members.timeout_until / voice_muted / voice_deafened
--   * timeout_member, voice_moderate (silenciar, ensurdecer, desconectar, mover)
--   * voice_access passa a respeitar castigo e silenciamento do servidor
--   * comandos privados por usuário no Realtime (tópico cmd:<uid>)
-- ============================================================================

create or replace function private.all_permissions() returns text[]
language sql immutable as $$
  select array[
    'administrator', 'manage_server', 'manage_roles', 'manage_channels',
    'create_invite', 'kick_members', 'ban_members', 'manage_messages',
    'send_messages', 'attach_files', 'add_reactions', 'mention_everyone',
    'connect_voice', 'speak', 'video', 'screen_share',
    'moderate_members', 'mute_members', 'deafen_members', 'move_members'
  ]
$$;

-- Cargos de moderação já existentes (quem pode expulsar) ganham as novas permissões.
update public.roles r
   set permissions = array(select distinct p from unnest(r.permissions || array['moderate_members', 'mute_members', 'deafen_members', 'move_members']) p)
 where 'kick_members' = any (r.permissions) and not r.is_default;

alter table public.members
  add column if not exists timeout_until timestamptz,
  add column if not exists voice_muted boolean not null default false,
  add column if not exists voice_deafened boolean not null default false;

create or replace function private.is_timed_out(p_server uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.members where server_id = p_server and user_id = p_user and timeout_until > now())
$$;

-- Bloqueios em nível de tabela: quem está de castigo não escreve em canais nem reage.
create or replace function private.guard_timeout_message() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid;
begin
  if new.channel_id is not null and new.author_id is not null then
    sid := private.channel_server(new.channel_id);
    if sid is not null and private.is_timed_out(sid, new.author_id) then
      raise exception 'timed_out' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists messages_timeout_guard on public.messages;
create trigger messages_timeout_guard before insert on public.messages
  for each row execute function private.guard_timeout_message();

create or replace function private.guard_timeout_reaction() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cid uuid; sid uuid;
begin
  select channel_id into cid from public.messages where id = new.message_id;
  if cid is not null then
    sid := private.channel_server(cid);
    if sid is not null and private.is_timed_out(sid, new.user_id) then
      raise exception 'timed_out' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists reactions_timeout_guard on public.reactions;
create trigger reactions_timeout_guard before insert on public.reactions
  for each row execute function private.guard_timeout_reaction();

-- ------------------------------------------------------------------ castigo ---
create or replace function public.timeout_member(p_server uuid, p_user uuid, p_seconds integer, p_reason text default '')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if not private.has_perm(p_server, uid, 'moderate_members') or not private.can_manage_member(p_server, uid, p_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_seconds is null or p_seconds <= 0 then
    update members set timeout_until = null where server_id = p_server and user_id = p_user;
    perform private.log_mod(p_server, uid, p_user, 'timeout_removed');
    return;
  end if;
  if p_seconds < 10 or p_seconds > 2419200 then raise exception 'invalid_input' using errcode = '22023'; end if;
  update members set timeout_until = now() + make_interval(secs => p_seconds) where server_id = p_server and user_id = p_user;
  perform private.log_mod(p_server, uid, p_user, 'timeout',
    jsonb_build_object('seconds', p_seconds, 'reason', left(coalesce(p_reason, ''), 200)));
end $$;

-- --------------------------------------------------- permissões de mídia ---
-- Fontes (mic/câmera/tela) e escuta permitidas a p_user no canal, já considerando
-- castigo e silenciamento/ensurdecimento do servidor.
create or replace function private.voice_perms(p_channel uuid, p_user uuid)
returns table (server_id uuid, can_speak boolean, can_video boolean, can_screen boolean, can_listen boolean, timed_out boolean, server_muted boolean, server_deafened boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  sid uuid := private.channel_server(p_channel);
  m members;
  block boolean;
begin
  select * into m from members where members.server_id = sid and user_id = p_user;
  block := coalesce(m.timeout_until > now(), false) or coalesce(m.voice_muted, false);
  return query select
    sid,
    private.has_perm(sid, p_user, 'speak') and not block,
    private.has_perm(sid, p_user, 'video') and not block,
    private.has_perm(sid, p_user, 'screen_share') and not block,
    not coalesce(m.voice_deafened, false),
    coalesce(m.timeout_until > now(), false),
    coalesce(m.voice_muted, false),
    coalesce(m.voice_deafened, false);
end $$;

drop function if exists public.voice_access(uuid);
create or replace function public.voice_access(p_channel uuid)
returns table (
  server_id uuid, channel_name text, can_connect boolean, can_speak boolean,
  can_video boolean, can_screen boolean, can_listen boolean, display_name text, avatar_path text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  sid uuid;
  k text;
  vp record;
begin
  perform private.rate_limit(uid, 'voice_token', 30, 60);
  select c.server_id, c.kind into sid, k from channels c where c.id = p_channel;
  if sid is null or k <> 'voice' or not private.can_use_channel(p_channel, uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into vp from private.voice_perms(p_channel, uid);
  return query
    select sid,
           (select c.name from channels c where c.id = p_channel),
           true, vp.can_speak, vp.can_video, vp.can_screen, vp.can_listen,
           coalesce(nullif((select m.nickname from members m where m.server_id = sid and m.user_id = uid), ''),
                    (select nullif(p.display_name, '') from profiles p where p.id = uid),
                    (select p.username from profiles p where p.id = uid)),
           (select p.avatar_path from profiles p where p.id = uid);
end $$;
revoke all on function public.voice_access(uuid) from public, anon;
grant execute on function public.voice_access(uuid) to authenticated;

-- ------------------------------------------------ moderação de voz (RPC) ---
-- Valida permissão/hierarquia, grava o estado e devolve o que a Edge Function
-- "voice-moderate" precisa aplicar no servidor LiveKit.
create or replace function public.voice_moderate(p_server uuid, p_target uuid, p_action text, p_channel uuid default null, p_dest uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  perm text;
  vp record;
  src uuid := p_channel;
begin
  if p_action not in ('mute', 'unmute', 'deafen', 'undeafen', 'disconnect', 'move') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  perm := case p_action when 'mute' then 'mute_members' when 'unmute' then 'mute_members'
                        when 'deafen' then 'deafen_members' when 'undeafen' then 'deafen_members'
                        else 'move_members' end;
  if not private.has_perm(p_server, uid, perm) or not private.can_manage_member(p_server, uid, p_target) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.rate_limit(uid, 'voice_moderate', 30, 60);
  if src is not null and (private.channel_server(src) is distinct from p_server
       or not private.can_view_channel(src, uid)
       or (select kind from channels where id = src) <> 'voice') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if p_action in ('mute', 'unmute') then
    update members set voice_muted = (p_action = 'mute') where server_id = p_server and user_id = p_target;
  elsif p_action in ('deafen', 'undeafen') then
    update members set voice_deafened = (p_action = 'deafen') where server_id = p_server and user_id = p_target;
  elsif p_action = 'move' then
    if p_dest is null or private.channel_server(p_dest) is distinct from p_server
       or (select kind from channels where id = p_dest) <> 'voice'
       or not private.can_view_channel(p_dest, uid)
       or not private.can_use_channel(p_dest, p_target) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end if;

  if p_action in ('move', 'disconnect') then
    -- comando privado ao cliente do alvo (o LiveKit já o remove da sala pela Edge Function)
    perform realtime.send(jsonb_build_object('server_id', p_server, 'channel_id', p_dest, 'by', uid), p_action, 'cmd:' || p_target::text, true);
  end if;
  perform private.log_mod(p_server, uid, p_target, 'voice_' || p_action,
    jsonb_build_object('channel', src, 'dest', p_dest));

  select * into vp from private.voice_perms(coalesce(src, p_dest), p_target);
  return jsonb_build_object(
    'action', p_action, 'channel_id', src, 'dest', p_dest,
    'can_speak', coalesce(vp.can_speak, false), 'can_video', coalesce(vp.can_video, false),
    'can_screen', coalesce(vp.can_screen, false), 'can_listen', coalesce(vp.can_listen, true));
end $$;

-- Comandos privados: só o próprio usuário lê o tópico cmd:<uid>; ninguém escreve pelo cliente.
create or replace function private.realtime_topic_allowed(p_topic text, p_user uuid, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  k text := split_part(coalesce(p_topic, ''), ':', 1);
  rid uuid;
begin
  begin
    rid := split_part(p_topic, ':', 2)::uuid;
  exception when others then
    return false;
  end;
  if p_user is null then return false; end if;
  return case k
    when 'srv' then private.is_member(rid, p_user)
    when 'chan' then private.can_view_channel(rid, p_user)
    when 'dm' then private.is_dm_participant(rid, p_user)
    when 'fr' then rid = p_user or (not p_write and private.shares_context(p_user, rid))
    when 'cmd' then rid = p_user and not p_write
    else false
  end;
end $$;

-- ------------------------------------------------------------------ create_server
-- (atualizado: o cargo Moderador já nasce com as novas permissões)
create or replace function public.create_server(p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  sid uuid;
  cat_text uuid;
  cat_voice uuid;
begin
  if not private.is_active(uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) not between 1 and 100 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  perform private.rate_limit(uid, 'create_server', 5, 3600);

  insert into servers (name, owner_id) values (p_name, uid) returning id into sid;

  insert into roles (server_id, name, color, position, permissions, is_default, hoist)
  values (sid, 'Membro', '#99aab5', 0,
          array['send_messages','attach_files','add_reactions','create_invite','connect_voice','speak','video','screen_share'], true, false);
  insert into roles (server_id, name, color, position, permissions)
  values (sid, 'Moderador', '#3ba55d', 50,
          array['kick_members','ban_members','manage_messages','mention_everyone','moderate_members','mute_members','deafen_members','move_members']);
  insert into roles (server_id, name, color, position, permissions)
  values (sid, 'Administrador', '#ed4245', 100, array['administrator']);

  insert into members (server_id, user_id) values (sid, uid);

  insert into categories (server_id, name, position) values (sid, 'Canais de texto', 0) returning id into cat_text;
  insert into categories (server_id, name, position) values (sid, 'Canais de voz', 1) returning id into cat_voice;
  insert into channels (server_id, category_id, name, kind, position) values (sid, cat_text, 'geral', 'text', 0);
  insert into channels (server_id, category_id, name, kind, position) values (sid, cat_voice, 'Voz geral', 'voice', 0);

  perform private.log_mod(sid, uid, null, 'server_created');
  return sid;
end $$;

revoke all on function public.timeout_member(uuid, uuid, integer, text) from public, anon;
revoke all on function public.voice_moderate(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.timeout_member(uuid, uuid, integer, text) to authenticated;
grant execute on function public.voice_moderate(uuid, uuid, text, uuid, uuid) to authenticated;
revoke all on function private.voice_perms(uuid, uuid) from public, anon, authenticated;
