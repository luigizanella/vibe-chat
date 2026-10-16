-- 0014: convite com código personalizado + frase do bot de música.

-- ----------------------------------------------------------- convites (slug) ---
-- Códigos personalizados: a-z, 0-9 e hífen, 3 a 32 caracteres, únicos no app inteiro.
-- Só quem gerencia o servidor pode criar um código personalizado (os aleatórios seguem para quem tem "criar convites").
drop function if exists public.create_invite(uuid, integer, integer);

create or replace function public.create_invite(p_server uuid, p_expires_seconds integer default 604800, p_max_uses integer default null, p_slug text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  v_code text;
  slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if not private.has_perm(p_server, uid, 'create_invite') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_max_uses is not null and p_max_uses < 1 then raise exception 'invalid_input' using errcode = '22023'; end if;
  if p_expires_seconds is not null and (p_expires_seconds < 60 or p_expires_seconds > 31536000) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  perform private.rate_limit(uid, 'create_invite', 20, 3600);

  if slug <> '' then
    if not private.has_perm(p_server, uid, 'manage_server') then raise exception 'forbidden' using errcode = '42501'; end if;
    if slug !~ '^[a-z0-9]([a-z0-9-]{1,30})[a-z0-9]$' then raise exception 'invalid_slug' using errcode = '22023'; end if;
    if slug = any (array['admin','api','app','login','logout','register','signup','convite','invite','invites','settings','suporte','support','vibe','vibechat','discord','null','undefined','www','root','me']) then
      raise exception 'reserved_slug' using errcode = '22023';
    end if;
    if exists (select 1 from invites where code = slug) then raise exception 'slug_taken' using errcode = '23505'; end if;
    v_code := slug;
  else
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  end if;

  insert into invites (code, server_id, created_by, expires_at, max_uses)
  values (v_code, p_server, uid,
          case when p_expires_seconds is null then null else now() + make_interval(secs => p_expires_seconds) end,
          p_max_uses);
  return v_code;
end $$;
revoke all on function public.create_invite(uuid, integer, integer, text) from public, anon;
grant execute on function public.create_invite(uuid, integer, integer, text) to authenticated;

-- códigos são comparados em minúsculas (quem digita "Meu-Servidor" entra do mesmo jeito)
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
    where i.code = lower(p_code);
end $$;

create or replace function public.join_server(p_code text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := private.require_uid();
  inv invites;
  c text := lower(p_code);
begin
  if not private.is_active(uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.rate_limit(uid, 'join_server', 15, 600);
  select * into inv from invites where code = c for update;
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
  update invites set uses = uses + 1 where code = c;
  return inv.server_id;
end $$;

-- ------------------------------------------------------------------ bot ---
update public.profiles set custom_status = 'Toque música com a galera'
 where id = '00000000-0000-4000-8000-00000000b075'::uuid;
