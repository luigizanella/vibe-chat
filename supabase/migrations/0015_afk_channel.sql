-- 0015: canal de ausentes (AFK) por servidor.
--  - afk_channel_id: canal de voz para onde quem fica ocioso é movido (sempre MUDO: ninguém publica áudio/vídeo/tela nele);
--  - afk_timeout_minutes: tempo de inatividade (1, 5, 10, 15, 30 ou 60 minutos).
alter table public.servers add column if not exists afk_channel_id uuid references public.channels (id) on delete set null;
alter table public.servers add column if not exists afk_timeout_minutes integer not null default 5;
alter table public.servers drop constraint if exists servers_afk_timeout;
alter table public.servers add constraint servers_afk_timeout check (afk_timeout_minutes in (1, 5, 10, 15, 30, 60));

-- Só quem gerencia o servidor altera (as colunas não estão no grant de UPDATE direto: vale somente esta função).
create or replace function public.set_afk(p_server uuid, p_channel uuid, p_minutes integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  if not private.has_perm(p_server, uid, 'manage_server') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_minutes is null or p_minutes not in (1, 5, 10, 15, 30, 60) then raise exception 'invalid_input' using errcode = '22023'; end if;
  if p_channel is not null and not exists (select 1 from channels where id = p_channel and server_id = p_server and kind = 'voice') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update servers set afk_channel_id = p_channel, afk_timeout_minutes = p_minutes where id = p_server;
end $$;
revoke all on function public.set_afk(uuid, uuid, integer) from public, anon;
grant execute on function public.set_afk(uuid, uuid, integer) to authenticated;

-- No canal de ausentes ninguém fala, liga câmera nem compartilha tela: aplicado no TOKEN da LiveKit (canPublish = false).
create or replace function private.voice_perms(p_channel uuid, p_user uuid)
returns table (server_id uuid, can_speak boolean, can_video boolean, can_screen boolean, can_listen boolean, timed_out boolean, server_muted boolean, server_deafened boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  sid uuid := private.channel_server(p_channel);
  m members;
  block boolean;
  afk boolean;
begin
  select * into m from members where members.server_id = sid and user_id = p_user;
  afk := exists (select 1 from servers s where s.id = sid and s.afk_channel_id = p_channel);
  block := coalesce(m.timeout_until > now(), false) or coalesce(m.voice_muted, false) or afk;
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
