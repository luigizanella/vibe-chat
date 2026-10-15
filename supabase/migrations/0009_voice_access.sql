-- ============================================================================
-- 0009_voice_access.sql — Autorização de mídia (LiveKit)
-- A Edge Function "livekit-token" chama esta RPC COM O JWT DO USUÁRIO; ela
-- decide se o token pode ser emitido e quais fontes (mic/câmera/tela) são
-- permitidas. O segredo do LiveKit nunca sai da Edge Function.
-- ============================================================================

create or replace function public.voice_access(p_channel uuid)
returns table (
  server_id uuid, channel_name text, can_connect boolean, can_speak boolean,
  can_video boolean, can_screen boolean, display_name text, avatar_path text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  sid uuid;
  k text;
begin
  perform private.rate_limit(uid, 'voice_token', 30, 60);
  select c.server_id, c.kind into sid, k from channels c where c.id = p_channel;
  if sid is null or k <> 'voice' or not private.can_use_channel(p_channel, uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select sid,
           (select c.name from channels c where c.id = p_channel),
           true,
           private.has_perm(sid, uid, 'speak'),
           private.has_perm(sid, uid, 'video'),
           private.has_perm(sid, uid, 'screen_share'),
           coalesce(nullif((select m.nickname from members m where m.server_id = sid and m.user_id = uid), ''),
                    (select nullif(p.display_name, '') from profiles p where p.id = uid),
                    (select p.username from profiles p where p.id = uid)),
           (select p.avatar_path from profiles p where p.id = uid);
end $$;

revoke all on function public.voice_access(uuid) from public, anon;
grant execute on function public.voice_access(uuid) to authenticated;
