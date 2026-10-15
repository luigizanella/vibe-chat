-- ============================================================================
-- 0001_schema.sql — Tabelas principais
--
-- Modelo:
--   profiles ─┬─ servers ─┬─ roles ── member_roles ── members
--             │           ├─ categories ── channels ── channel_overwrites
--             │           ├─ invites / bans / mod_logs
--   messages (canal OU conversa direta) ── attachments / reactions
--   dm_conversations ── dm_participants, friendships, blocks
--   read_states, notification_prefs, user_prefs, rate_events
--
-- Toda escrita sensível passa por funções RPC (SECURITY DEFINER) definidas nas
-- migrations seguintes; as tabelas só têm políticas de SELECT (e poucas
-- exceções documentadas em 0003_rls.sql).
-- ============================================================================

create schema if not exists private;

-- ----------------------------------------------------------------- perfis ---
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  username       text not null,
  display_name   text not null default '',
  avatar_path    text,
  banner_path    text,
  banner_color   text,
  bio            text not null default '',
  custom_status  text not null default '',
  status_pref    text not null default 'online',
  onboarded      boolean not null default false,
  disabled_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_.]{2,32}$'),
  constraint profiles_display_name_len check (char_length(display_name) <= 32),
  constraint profiles_bio_len check (char_length(bio) <= 300),
  constraint profiles_custom_status_len check (char_length(custom_status) <= 80),
  constraint profiles_status_pref check (status_pref in ('online', 'idle', 'dnd', 'invisible')),
  constraint profiles_banner_color check (banner_color is null or banner_color ~ '^#[0-9a-fA-F]{6}$')
);
create unique index profiles_username_key on public.profiles (username);

create table public.user_prefs (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  settings        jsonb not null default '{}'::jsonb,
  dm_policy       text not null default 'everyone',
  friend_requests text not null default 'everyone',
  updated_at      timestamptz not null default now(),
  constraint user_prefs_dm_policy check (dm_policy in ('everyone', 'friends', 'nobody')),
  constraint user_prefs_friend_requests check (friend_requests in ('everyone', 'nobody')),
  constraint user_prefs_settings_size check (pg_column_size(settings) < 16384)
);

-- -------------------------------------------------------------- servidores ---
create table public.servers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  icon_path  text,
  owner_id   uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint servers_name_len check (char_length(name) between 1 and 100)
);
create index servers_owner_idx on public.servers (owner_id);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.servers (id) on delete cascade,
  name        text not null,
  color       text not null default '#99aab5',
  position    integer not null default 0,
  permissions text[] not null default '{}',
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint roles_name_len check (char_length(name) between 1 and 50),
  constraint roles_color check (color ~ '^#[0-9a-fA-F]{6}$')
);
create index roles_server_idx on public.roles (server_id, position desc);
create unique index roles_one_default on public.roles (server_id) where is_default;

create table public.members (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  nickname  text,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id),
  constraint members_nickname_len check (nickname is null or char_length(nickname) <= 32)
);
create index members_user_idx on public.members (user_id);

create table public.member_roles (
  server_id uuid not null,
  user_id   uuid not null,
  role_id   uuid not null references public.roles (id) on delete cascade,
  primary key (server_id, user_id, role_id),
  foreign key (server_id, user_id) references public.members (server_id, user_id) on delete cascade
);
create index member_roles_role_idx on public.member_roles (role_id);

create table public.categories (
  id        uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  name      text not null,
  position  integer not null default 0,
  constraint categories_name_len check (char_length(name) between 1 and 50)
);
create index categories_server_idx on public.categories (server_id, position);

create table public.channels (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.servers (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  name        text not null,
  kind        text not null default 'text',
  topic       text not null default '',
  position    integer not null default 0,
  is_private  boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint channels_kind check (kind in ('text', 'voice')),
  constraint channels_name_len check (char_length(name) between 1 and 100),
  constraint channels_topic_len check (char_length(topic) <= 1024)
);
create index channels_server_idx on public.channels (server_id, position);
create index channels_category_idx on public.channels (category_id);

-- can_view / can_send: NULL = herdar, true = permitir, false = negar.
create table public.channel_overwrites (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  role_id    uuid references public.roles (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  can_view   boolean,
  can_send   boolean,
  constraint overwrites_one_target check (num_nonnulls(role_id, user_id) = 1)
);
create unique index overwrites_role_key on public.channel_overwrites (channel_id, role_id) where role_id is not null;
create unique index overwrites_user_key on public.channel_overwrites (channel_id, user_id) where user_id is not null;

create table public.invites (
  code       text primary key,
  server_id  uuid not null references public.servers (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz,
  max_uses   integer,
  uses       integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invites_max_uses check (max_uses is null or max_uses > 0)
);
create index invites_server_idx on public.invites (server_id);

create table public.bans (
  server_id  uuid not null references public.servers (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  banned_by  uuid references public.profiles (id) on delete set null,
  reason     text not null default '',
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table public.mod_logs (
  id         bigint generated always as identity primary key,
  server_id  uuid not null references public.servers (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  target_id  uuid,
  action     text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index mod_logs_server_idx on public.mod_logs (server_id, created_at desc);

-- ------------------------------------------------- mensagens diretas/amigos ---
create table public.dm_conversations (
  id              uuid primary key default gen_random_uuid(),
  is_group        boolean not null default false,
  name            text,
  pair_key        text unique,        -- "uidMenor:uidMaior" para conversas 1:1
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint dm_name_len check (name is null or char_length(name) <= 100),
  constraint dm_pair_key check (is_group or pair_key is not null)
);

create table public.dm_participants (
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index dm_participants_user_idx on public.dm_participants (user_id);

create table public.friendships (
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  constraint friendships_not_self check (requester_id <> addressee_id),
  constraint friendships_status check (status in ('pending', 'accepted'))
);
-- impede pares duplicados invertidos (A->B e B->A)
create unique index friendships_pair_key
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

-- --------------------------------------------------------------- mensagens ---
create table public.messages (
  id                uuid primary key default gen_random_uuid(),
  channel_id        uuid references public.channels (id) on delete cascade,
  dm_id             uuid references public.dm_conversations (id) on delete cascade,
  author_id         uuid references public.profiles (id) on delete set null,
  content           text not null default '',
  reply_to_id       uuid references public.messages (id) on delete set null,
  mention_user_ids  uuid[] not null default '{}',
  mention_role_ids  uuid[] not null default '{}',
  mention_everyone  boolean not null default false,
  edited_at         timestamptz,
  pinned_at         timestamptz,
  pinned_by         uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  fts               tsvector generated always as (to_tsvector('simple', content)) stored,
  constraint messages_one_scope check (num_nonnulls(channel_id, dm_id) = 1),
  constraint messages_content_len check (char_length(content) <= 4000)
);
create index messages_channel_idx on public.messages (channel_id, created_at desc, id desc) where channel_id is not null;
create index messages_dm_idx on public.messages (dm_id, created_at desc, id desc) where dm_id is not null;
create index messages_fts_idx on public.messages using gin (fts);
create index messages_pinned_idx on public.messages (channel_id, dm_id) where pinned_at is not null;
create index messages_reply_idx on public.messages (reply_to_id) where reply_to_id is not null;

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages (id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  content_type text not null default 'application/octet-stream',
  size_bytes   bigint not null,
  created_at   timestamptz not null default now(),
  constraint attachments_size check (size_bytes between 0 and 26214400),
  constraint attachments_name_len check (char_length(file_name) between 1 and 255)
);
create index attachments_message_idx on public.attachments (message_id);

create table public.reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint reactions_emoji_len check (char_length(emoji) between 1 and 32)
);

-- Último instante lido por usuário em cada canal / conversa.
create table public.read_states (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  channel_id   uuid references public.channels (id) on delete cascade,
  dm_id        uuid references public.dm_conversations (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  constraint read_states_one_scope check (num_nonnulls(channel_id, dm_id) = 1)
);
create unique index read_states_channel_key on public.read_states (user_id, channel_id) where channel_id is not null;
create unique index read_states_dm_key on public.read_states (user_id, dm_id) where dm_id is not null;

create table public.notification_prefs (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles (id) on delete cascade,
  server_id uuid references public.servers (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete cascade,
  dm_id     uuid references public.dm_conversations (id) on delete cascade,
  muted     boolean not null default false,
  level     text not null default 'all',
  constraint notif_one_scope check (num_nonnulls(server_id, channel_id, dm_id) = 1),
  constraint notif_level check (level in ('all', 'mentions', 'none'))
);
create unique index notif_server_key on public.notification_prefs (user_id, server_id) where server_id is not null;
create unique index notif_channel_key on public.notification_prefs (user_id, channel_id) where channel_id is not null;
create unique index notif_dm_key on public.notification_prefs (user_id, dm_id) where dm_id is not null;

-- Eventos para limitação de taxa (rate limiting). Sem acesso direto pelo cliente.
create table public.rate_events (
  user_id uuid not null,
  action  text not null,
  at      timestamptz not null default now()
);
create index rate_events_idx on public.rate_events (user_id, action, at desc);
