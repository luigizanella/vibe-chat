-- ============================================================================
-- 0003_rls.sql — Row Level Security
--
-- Regra geral: o cliente (role "authenticated") só LÊ via políticas abaixo.
-- Escritas passam por RPCs SECURITY DEFINER (0004–0006), que validam permissões.
-- Exceções com escrita direta (limitada por política + privilégios de coluna):
--   profiles (próprio perfil), user_prefs, notification_prefs (próprios).
-- ============================================================================

alter table public.profiles           enable row level security;
alter table public.user_prefs         enable row level security;
alter table public.servers            enable row level security;
alter table public.roles              enable row level security;
alter table public.members            enable row level security;
alter table public.member_roles       enable row level security;
alter table public.categories         enable row level security;
alter table public.channels           enable row level security;
alter table public.channel_overwrites enable row level security;
alter table public.invites            enable row level security;
alter table public.bans               enable row level security;
alter table public.mod_logs           enable row level security;
alter table public.dm_conversations   enable row level security;
alter table public.dm_participants    enable row level security;
alter table public.friendships        enable row level security;
alter table public.blocks             enable row level security;
alter table public.messages           enable row level security;
alter table public.attachments        enable row level security;
alter table public.reactions          enable row level security;
alter table public.read_states        enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.rate_events        enable row level security;  -- sem políticas: ninguém lê

-- perfis -------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (private.shares_context(auth.uid(), id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- preferências -------------------------------------------------------------
create policy user_prefs_select on public.user_prefs for select to authenticated using (user_id = auth.uid());
create policy user_prefs_insert on public.user_prefs for insert to authenticated with check (user_id = auth.uid());
create policy user_prefs_update on public.user_prefs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notif_select on public.notification_prefs for select to authenticated using (user_id = auth.uid());
create policy notif_insert on public.notification_prefs for insert to authenticated with check (user_id = auth.uid());
create policy notif_update on public.notification_prefs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on public.notification_prefs for delete to authenticated using (user_id = auth.uid());

create policy read_states_select on public.read_states for select to authenticated using (user_id = auth.uid());

-- servidores ---------------------------------------------------------------
create policy servers_select on public.servers for select to authenticated
  using (private.is_member(id, auth.uid()));
create policy roles_select on public.roles for select to authenticated
  using (private.is_member(server_id, auth.uid()));
create policy members_select on public.members for select to authenticated
  using (private.is_member(server_id, auth.uid()));
create policy member_roles_select on public.member_roles for select to authenticated
  using (private.is_member(server_id, auth.uid()));
create policy categories_select on public.categories for select to authenticated
  using (private.is_member(server_id, auth.uid()));

-- canais privados só aparecem para quem pode vê-los
create policy channels_select on public.channels for select to authenticated
  using (private.can_view_channel(id, auth.uid()));
create policy overwrites_select on public.channel_overwrites for select to authenticated
  using (private.has_perm(private.channel_server(channel_id), auth.uid(), 'manage_channels'));

create policy invites_select on public.invites for select to authenticated
  using (
    private.has_perm(server_id, auth.uid(), 'manage_server')
    or (created_by = auth.uid() and private.is_member(server_id, auth.uid()))
  );
create policy bans_select on public.bans for select to authenticated
  using (private.has_perm(server_id, auth.uid(), 'ban_members'));
create policy mod_logs_select on public.mod_logs for select to authenticated
  using (private.has_perm(server_id, auth.uid(), 'ban_members') or private.has_perm(server_id, auth.uid(), 'manage_server'));

-- DMs / amigos ---------------------------------------------------------------
create policy dm_conv_select on public.dm_conversations for select to authenticated
  using (private.is_dm_participant(id, auth.uid()));
create policy dm_part_select on public.dm_participants for select to authenticated
  using (private.is_dm_participant(conversation_id, auth.uid()));
create policy friendships_select on public.friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy blocks_select on public.blocks for select to authenticated
  using (blocker_id = auth.uid());

-- mensagens (somente leitura direta; escrita via RPC) ----------------------------
create policy messages_select on public.messages for select to authenticated
  using (private.can_read_scope(channel_id, dm_id, auth.uid()));
create policy attachments_select on public.attachments for select to authenticated
  using (private.can_read_message(message_id, auth.uid()));
create policy reactions_select on public.reactions for select to authenticated
  using (private.can_read_message(message_id, auth.uid()));
