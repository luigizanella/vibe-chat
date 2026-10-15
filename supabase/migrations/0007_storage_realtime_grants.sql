-- ============================================================================
-- 0007_storage_realtime_grants.sql
--   * Buckets e políticas do Storage
--   * Autorização dos canais Realtime (broadcast/presence privados)
--   * Publicação Realtime (postgres_changes)
--   * Privilégios (GRANT/REVOKE) — mínimo necessário
-- ============================================================================

-- ------------------------------------------------------------ Realtime ---
-- Tópicos: srv:<server>  chan:<canal>  dm:<conversa>  fr:<usuario>
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
    -- presença de amigos/colegas: qualquer um com contexto lê, só o próprio escreve
    when 'fr' then rid = p_user or (not p_write and private.shares_context(p_user, rid))
    else false
  end;
end $$;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists vibe_rt_read on realtime.messages';
    execute 'drop policy if exists vibe_rt_write on realtime.messages';
    execute $p$create policy vibe_rt_read on realtime.messages for select to authenticated
      using (private.realtime_topic_allowed((select realtime.topic()), auth.uid(), false))$p$;
    execute $p$create policy vibe_rt_write on realtime.messages for insert to authenticated
      with check (private.realtime_topic_allowed((select realtime.topic()), auth.uid(), true))$p$;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    perform 1;
    begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.reactions; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.attachments; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.members; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.member_roles; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.roles; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.channels; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.categories; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.servers; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.friendships; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.dm_participants; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.dm_conversations; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
  end if;
end $$;

create or replace function private.safe_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create or replace function private.media_path_allowed(p_name text, p_user uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare parts text[] := string_to_array(p_name, '/');
begin
  if p_user is null or array_length(parts, 1) < 3 or p_name like '%..%' then return false; end if;
  if parts[1] in ('avatars', 'banners') then
    return parts[2] = p_user::text;
  elsif parts[1] = 'servers' then
    return private.safe_uuid(parts[2]) is not null
       and private.has_perm(private.safe_uuid(parts[2]), p_user, 'manage_server');
  end if;
  return false;
end $$;

create or replace function private.attachment_path_readable(p_name text, p_user uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  parts text[] := string_to_array(p_name, '/');
  sid uuid := private.safe_uuid(parts[2]);
begin
  if p_user is null or array_length(parts, 1) < 5 or sid is null then return false; end if;
  return case parts[1]
    when 'c' then private.can_view_channel(sid, p_user)
    when 'd' then private.is_dm_participant(sid, p_user)
    else false end;
end $$;

create or replace function private.attachment_path_writable(p_name text, p_user uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  parts text[] := string_to_array(p_name, '/');
  sid uuid := private.safe_uuid(parts[2]);
begin
  if p_user is null or array_length(parts, 1) < 5 or sid is null or parts[3] <> p_user::text or p_name like '%..%' then
    return false;
  end if;
  return case parts[1]
    when 'c' then private.can_use_channel(sid, p_user)
                  and private.has_perm(private.channel_server(sid), p_user, 'attach_files')
    when 'd' then private.is_dm_participant(sid, p_user)
    else false end;
end $$;

-- ------------------------------------------------------------ Privilégios ---
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

grant usage on schema private to authenticated;
-- funções usadas por políticas RLS (executadas com o papel do usuário)
grant execute on function
  private.is_member(uuid, uuid), private.is_owner(uuid, uuid), private.has_perm(uuid, uuid, text),
  private.can_view_channel(uuid, uuid), private.can_read_scope(uuid, uuid, uuid),
  private.can_read_message(uuid, uuid), private.shares_context(uuid, uuid),
  private.is_dm_participant(uuid, uuid), private.channel_server(uuid),
  private.realtime_topic_allowed(text, uuid, boolean),
  private.media_path_allowed(text, uuid), private.attachment_path_readable(text, uuid),
  private.attachment_path_writable(text, uuid), private.safe_uuid(text)
to authenticated;

grant select on
  public.profiles, public.user_prefs, public.servers, public.roles, public.members, public.member_roles,
  public.categories, public.channels, public.channel_overwrites, public.invites, public.bans, public.mod_logs,
  public.dm_conversations, public.dm_participants, public.friendships, public.blocks,
  public.messages, public.attachments, public.reactions, public.read_states, public.notification_prefs
to authenticated;

grant update (username, display_name, avatar_path, banner_path, banner_color, bio, custom_status, status_pref, onboarded)
  on public.profiles to authenticated;
grant insert (user_id, settings, dm_policy, friend_requests), update (settings, dm_policy, friend_requests, updated_at)
  on public.user_prefs to authenticated;
grant insert (user_id, server_id, channel_id, dm_id, muted, level), update (muted, level), delete
  on public.notification_prefs to authenticated;

-- RPCs expostas
grant execute on function
  public.create_server(text), public.update_server(uuid, text, text, boolean), public.delete_server(uuid),
  public.leave_server(uuid), public.transfer_ownership(uuid, uuid), public.set_nickname(uuid, text),
  public.create_invite(uuid, integer, integer), public.revoke_invite(text), public.preview_invite(text),
  public.join_server(text),
  public.create_role(uuid, text, text, text[]), public.update_role(uuid, text, text, text[], integer),
  public.delete_role(uuid), public.set_member_role(uuid, uuid, uuid, boolean),
  public.kick_member(uuid, uuid, text), public.ban_member(uuid, uuid, text), public.unban_member(uuid, uuid),
  public.create_category(uuid, text), public.update_category(uuid, text), public.delete_category(uuid),
  public.create_channel(uuid, text, text, uuid, boolean), public.update_channel(uuid, text, text, boolean),
  public.delete_channel(uuid), public.reorder_layout(uuid, jsonb, jsonb),
  public.set_channel_overwrite(uuid, uuid, uuid, boolean, boolean),
  public.send_message(uuid, uuid, uuid, text, uuid, jsonb), public.edit_message(uuid, text),
  public.delete_message(uuid), public.toggle_reaction(uuid, text), public.set_pinned(uuid, boolean),
  public.mark_read(uuid, uuid), public.unread_summary(),
  public.search_messages(text, uuid, uuid, uuid, integer, timestamptz),
  public.search_users(text, integer), public.send_friend_request(text),
  public.respond_friend_request(uuid, boolean), public.remove_friend(uuid),
  public.block_user(uuid), public.unblock_user(uuid), public.open_dm(uuid),
  public.create_group_dm(uuid[], text), public.leave_dm(uuid),
  public.deactivate_account(), public.reactivate_account()
to authenticated;

grant execute on function public.username_available(text) to anon, authenticated;
-- prepare_account_deletion: apenas service_role (Edge Function delete-account)
grant execute on function public.prepare_account_deletion(uuid) to service_role;
