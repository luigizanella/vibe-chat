-- ============================================================================
-- 0013_music_bot.sql — Bot de música "Vibe Beats"
--
-- Sem servidor de áudio: cada ouvinte toca o vídeo no player oficial do YouTube
-- (IFrame API). Aqui fica apenas o ESTADO compartilhado (fila e posição), sincronizado
-- por Realtime. Nada de download de áudio.
-- ============================================================================

-- Perfil do bot (sem senha e sem login possível). UUID fixo.
create or replace function private.music_bot_id() returns uuid language sql immutable as $$
  select '00000000-0000-4000-8000-00000000b075'::uuid
$$;

do $$
begin
  if not exists (select 1 from auth.users where id = private.music_bot_id()) then
    insert into auth.users (id, email, raw_user_meta_data)
    values (private.music_bot_id(), 'vibebeats@bot.invalid', '{"username":"vibebeats","display_name":"Vibe Beats"}'::jsonb);
  end if;
  update public.profiles
     set is_bot = true, display_name = 'Vibe Beats', custom_status = '/tocar · /ajuda',
         avatar_path = 'app:logo', onboarded = true
   where id = private.music_bot_id();
end $$;

alter table public.servers add column if not exists music_channel_id uuid references public.channels (id) on delete set null;

create table public.music_sessions (
  channel_id      uuid primary key references public.channels (id) on delete cascade,
  server_id       uuid not null references public.servers (id) on delete cascade,
  status          text not null default 'idle' check (status in ('idle', 'playing', 'paused')),
  video_id        text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title           text,
  added_by        uuid references public.profiles (id) on delete set null,
  started_at      timestamptz,             -- instante (servidor) em que a posição 0 ocorreria
  paused_ms       integer not null default 0,
  prev_video_id   text,
  prev_title      text,
  rev             bigint not null default 0,
  updated_at      timestamptz not null default now()
);
create index music_sessions_server_idx on public.music_sessions (server_id);

create table public.music_queue (
  id         bigint generated always as identity primary key,
  channel_id uuid not null references public.channels (id) on delete cascade,
  ord        double precision not null,
  video_id   text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title      text not null check (char_length(title) between 1 and 200),
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index music_queue_idx on public.music_queue (channel_id, ord);

alter table public.music_sessions enable row level security;
alter table public.music_queue enable row level security;
create policy music_sessions_select on public.music_sessions for select to authenticated
  using (private.can_view_channel(channel_id, auth.uid()));
create policy music_queue_select on public.music_queue for select to authenticated
  using (private.can_view_channel(channel_id, auth.uid()));
grant select on public.music_sessions, public.music_queue to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.music_sessions; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.music_queue; exception when duplicate_object then null; end;
  end if;
end $$;

-- ------------------------------------------------------------------ helpers ---
create or replace function private.music_say(p_server uuid, p_text text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare cid uuid;
begin
  select music_channel_id into cid from servers where id = p_server;
  if cid is not null then
    insert into messages (channel_id, author_id, content) values (cid, private.music_bot_id(), left(p_text, 1900));
  end if;
end $$;

-- Valida: canal de voz do servidor, bot ativo, usuário pode usar o canal; devolve o servidor.
create or replace function private.music_guard(p_channel uuid, p_uid uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid; k text;
begin
  select server_id, kind into sid, k from channels where id = p_channel;
  if sid is null or k <> 'voice' or not private.can_use_channel(p_channel, p_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.is_member(sid, private.music_bot_id()) then
    raise exception 'bot_disabled' using errcode = '42501';
  end if;
  perform private.rate_limit(p_uid, 'music', 40, 60);
  insert into music_sessions (channel_id, server_id) values (p_channel, sid) on conflict (channel_id) do nothing;
  return sid;
end $$;

create or replace function private.clean_title(p text) returns text
language sql immutable as $$
  select left(coalesce(nullif(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g')), ''), 'Vídeo do YouTube'), 200)
$$;

-- Passa para o próximo item da fila (ou fica ocioso).
create or replace function private.music_advance(p_channel uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s music_sessions; q music_queue;
begin
  select * into s from music_sessions where channel_id = p_channel;
  select * into q from music_queue where channel_id = p_channel order by ord limit 1;
  if q.id is null then
    update music_sessions set prev_video_id = s.video_id, prev_title = s.title, status = 'idle', video_id = null, title = null,
      added_by = null, started_at = null, paused_ms = 0, rev = rev + 1, updated_at = now() where channel_id = p_channel;
  else
    delete from music_queue where id = q.id;
    update music_sessions set prev_video_id = s.video_id, prev_title = s.title, status = 'playing', video_id = q.video_id,
      title = q.title, added_by = q.added_by, started_at = now(), paused_ms = 0, rev = rev + 1, updated_at = now() where channel_id = p_channel;
  end if;
end $$;

-- --------------------------------------------------------------------- RPCs ---
create or replace function public.server_now() returns timestamptz language sql stable as $$ select now() $$;

create or replace function public.music_add(p_channel uuid, p_video text, p_title text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  sid uuid;
  s music_sessions;
  who text;
  t text := private.clean_title(p_title);
begin
  if p_video is null or p_video !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'invalid_input' using errcode = '22023'; end if;
  sid := private.music_guard(p_channel, uid);
  select * into s from music_sessions where channel_id = p_channel for update;
  select coalesce(nullif(display_name, ''), username) into who from profiles where id = uid;
  if s.status = 'idle' then
    update music_sessions set status = 'playing', video_id = p_video, title = t, added_by = uid, started_at = now(),
      paused_ms = 0, rev = rev + 1, updated_at = now() where channel_id = p_channel;
    perform private.music_say(sid, format('▶ **%s** tocando agora (pedido de %s).', t, who));
  else
    if (select count(*) from music_queue where channel_id = p_channel) >= 50 then raise exception 'limit_reached' using errcode = '22023'; end if;
    insert into music_queue (channel_id, ord, video_id, title, added_by)
    values (p_channel, coalesce((select max(ord) from music_queue where channel_id = p_channel), 0) + 1, p_video, t, uid);
    update music_sessions set rev = rev + 1, updated_at = now() where channel_id = p_channel;
    perform private.music_say(sid, format('➕ %s adicionou **%s** à fila.', who, t));
  end if;
end $$;

-- p_action: pause | resume | skip | back | stop. p_expect: no "skip", só avança se ainda for esse vídeo
-- (vários clientes avisam o fim da faixa ao mesmo tempo; só o primeiro vale).
create or replace function public.music_control(p_channel uuid, p_action text, p_expect text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  sid uuid;
  s music_sessions;
  pos integer;
  who text;
begin
  if p_action not in ('pause', 'resume', 'skip', 'back', 'stop') then raise exception 'invalid_input' using errcode = '22023'; end if;
  sid := private.music_guard(p_channel, uid);
  select * into s from music_sessions where channel_id = p_channel for update;
  select coalesce(nullif(display_name, ''), username) into who from profiles where id = uid;

  if p_action = 'pause' then
    if s.status = 'playing' then
      update music_sessions set status = 'paused', paused_ms = greatest(0, (extract(epoch from (now() - s.started_at)) * 1000)::int),
        rev = rev + 1, updated_at = now() where channel_id = p_channel;
    end if;
  elsif p_action = 'resume' then
    if s.status = 'paused' then
      update music_sessions set status = 'playing', started_at = now() - make_interval(secs => s.paused_ms / 1000.0),
        rev = rev + 1, updated_at = now() where channel_id = p_channel;
    end if;
  elsif p_action = 'skip' then
    if s.status <> 'idle' and (p_expect is null or p_expect = s.video_id) then
      perform private.music_advance(p_channel);
      if p_expect is null then perform private.music_say(sid, format('⏭ %s pulou **%s**.', who, coalesce(s.title, 'a faixa'))); end if;
    end if;
  elsif p_action = 'back' then
    pos := case s.status when 'playing' then (extract(epoch from (now() - s.started_at)) * 1000)::int when 'paused' then s.paused_ms else 0 end;
    if s.status = 'idle' and s.prev_video_id is not null then
      update music_sessions set status = 'playing', video_id = s.prev_video_id, title = s.prev_title, added_by = uid,
        started_at = now(), paused_ms = 0, prev_video_id = null, prev_title = null, rev = rev + 1, updated_at = now() where channel_id = p_channel;
    elsif s.status <> 'idle' and (pos > 5000 or s.prev_video_id is null) then
      update music_sessions set status = 'playing', started_at = now(), paused_ms = 0, rev = rev + 1, updated_at = now() where channel_id = p_channel;
    elsif s.status <> 'idle' then
      -- volta à faixa anterior; a atual vai para o início da fila
      insert into music_queue (channel_id, ord, video_id, title, added_by)
      values (p_channel, coalesce((select min(ord) from music_queue where channel_id = p_channel), 1) - 1, s.video_id, s.title, s.added_by);
      update music_sessions set status = 'playing', video_id = s.prev_video_id, title = s.prev_title, started_at = now(),
        paused_ms = 0, prev_video_id = null, prev_title = null, rev = rev + 1, updated_at = now() where channel_id = p_channel;
    end if;
  elsif p_action = 'stop' then
    delete from music_queue where channel_id = p_channel;
    update music_sessions set status = 'idle', video_id = null, title = null, added_by = null, started_at = null, paused_ms = 0,
      rev = rev + 1, updated_at = now() where channel_id = p_channel;
    perform private.music_say(sid, format('⏹ %s parou a música e limpou a fila.', who));
  end if;
end $$;

create or replace function public.music_remove(p_channel uuid, p_queue_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  perform private.music_guard(p_channel, uid);
  delete from music_queue where id = p_queue_id and channel_id = p_channel;
  update music_sessions set rev = rev + 1, updated_at = now() where channel_id = p_channel;
end $$;

-- Liga/desliga o bot no servidor (ele entra/sai da lista de membros).
create or replace function public.set_music_bot(p_server uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if not private.has_perm(p_server, uid, 'manage_server') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_enabled then
    insert into members (server_id, user_id) values (p_server, private.music_bot_id()) on conflict do nothing;
  else
    delete from music_sessions where server_id = p_server;
    delete from members where server_id = p_server and user_id = private.music_bot_id();
  end if;
  perform private.log_mod(p_server, uid, private.music_bot_id(), case when p_enabled then 'music_bot_on' else 'music_bot_off' end);
end $$;

-- Canal de texto em que os comandos de música são aceitos (e onde o bot responde).
create or replace function public.set_music_channel(p_server uuid, p_channel uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if not private.has_perm(p_server, uid, 'manage_server') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_channel is not null and not exists (select 1 from channels where id = p_channel and server_id = p_server and kind = 'text') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update servers set music_channel_id = p_channel where id = p_server;
end $$;

-- O bot não pode ser expulso/banido/castigado por moderadores (só desligado em "Música").
create or replace function private.can_manage_member(p_server uuid, p_actor uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_actor <> p_target
    and p_target <> private.music_bot_id()
    and private.is_member(p_server, p_target)
    and not private.is_owner(p_server, p_target)
    and private.top_position(p_server, p_actor) > private.top_position(p_server, p_target)
$$;

revoke all on function public.server_now() from public, anon;
revoke all on function public.music_add(uuid, text, text) from public, anon;
revoke all on function public.music_control(uuid, text, text) from public, anon;
revoke all on function public.music_remove(uuid, bigint) from public, anon;
revoke all on function public.set_music_bot(uuid, boolean) from public, anon;
revoke all on function public.set_music_channel(uuid, uuid) from public, anon;
grant execute on function public.server_now() to authenticated;
grant execute on function public.music_add(uuid, text, text) to authenticated;
grant execute on function public.music_control(uuid, text, text) to authenticated;
grant execute on function public.music_remove(uuid, bigint) to authenticated;
grant execute on function public.set_music_bot(uuid, boolean) to authenticated;
grant execute on function public.set_music_channel(uuid, uuid) to authenticated;
