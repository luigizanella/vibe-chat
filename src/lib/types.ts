declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string
export const APP_VERSION = __APP_VERSION__
export const BUILD_TIME = __BUILD_TIME__

export type StatusPref = 'online' | 'idle' | 'dnd' | 'invisible'
export type Presence = 'online' | 'idle' | 'dnd' | 'offline'

export interface Profile {
  id: string
  username: string
  display_name: string
  avatar_path: string | null
  banner_path: string | null
  banner_color: string | null
  bio: string
  custom_status: string
  status_pref: StatusPref
  onboarded: boolean
  is_bot: boolean
  disabled_at: string | null
  created_at: string
}
export type MiniProfile = Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_path'>

export interface Server {
  id: string
  name: string
  icon_path: string | null
  owner_id: string
  music_channel_id: string | null
  created_at: string
}
export interface MusicSession {
  channel_id: string
  server_id: string
  status: 'idle' | 'playing' | 'paused'
  video_id: string | null
  title: string | null
  added_by: string | null
  started_at: string | null
  paused_ms: number
  prev_video_id: string | null
  prev_title: string | null
  rev: number
}
export interface MusicQueueItem {
  id: number
  channel_id: string
  ord: number
  video_id: string
  title: string
  added_by: string | null
}

export interface Role {
  id: string
  server_id: string
  name: string
  color: string
  position: number
  permissions: string[]
  is_default: boolean
  /** Exibir os membros com este cargo em um grupo separado na lista. */
  hoist: boolean
}
export interface Member {
  server_id: string
  user_id: string
  nickname: string | null
  joined_at: string
  timeout_until: string | null
  voice_muted: boolean
  voice_deafened: boolean
  profile: Profile | null
  member_roles: { role_id: string }[]
}
export interface Category {
  id: string
  server_id: string
  name: string
  position: number
}
export interface Channel {
  id: string
  server_id: string
  category_id: string | null
  name: string
  kind: 'text' | 'voice'
  topic: string
  position: number
  is_private: boolean
}
export interface Invite {
  code: string
  server_id: string
  created_by: string | null
  expires_at: string | null
  max_uses: number | null
  uses: number
  revoked_at: string | null
  created_at: string
}
export interface Ban {
  server_id: string
  user_id: string
  reason: string
  created_at: string
  profile?: MiniProfile | null
}
export interface ModLog {
  id: number
  server_id: string
  actor_id: string | null
  target_id: string | null
  action: string
  details: Record<string, unknown>
  created_at: string
}

export interface Attachment {
  id: string
  message_id: string
  storage_path: string
  file_name: string
  content_type: string
  size_bytes: number
}
export interface Reaction {
  message_id: string
  user_id: string
  emoji: string
}
export interface Message {
  id: string
  channel_id: string | null
  dm_id: string | null
  author_id: string | null
  content: string
  reply_to_id: string | null
  mention_user_ids: string[]
  mention_role_ids: string[]
  mention_everyone: boolean
  edited_at: string | null
  pinned_at: string | null
  created_at: string
  author?: MiniProfile | null
  attachments?: Attachment[]
  reactions?: Reaction[]
  reply?: { id: string; content: string; author_id: string | null } | null
  /** Estado local de envio (não vem do banco). */
  _status?: 'sending' | 'failed'
  _pendingAttachments?: PendingAttachment[]
}
export interface PendingAttachment {
  file: File
  path: string
}

export interface DmConversation {
  id: string
  is_group: boolean
  name: string | null
  last_message_at: string
  dm_participants: { user_id: string; profile: MiniProfile | null }[]
}
export interface Friendship {
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
  created_at: string
}
export interface UnreadRow {
  channel_id: string | null
  dm_id: string | null
  unread_count: number
  mention_count: number
}
export interface NotifPref {
  id: string
  server_id: string | null
  channel_id: string | null
  dm_id: string | null
  muted: boolean
  level: 'all' | 'mentions' | 'none'
}

export const MESSAGE_SELECT =
  '*, author:profiles!author_id(id,username,display_name,avatar_path), attachments(*), reactions(*), reply:reply_to_id(id,content,author_id)'
