import type { Member, Role, Server } from './types'

export interface PermDef {
  key: string
  label: string
  description: string
  group: 'geral' | 'texto' | 'voz'
}

export const PERMISSIONS: PermDef[] = [
  { key: 'administrator', label: 'Administrador', description: 'Concede todas as permissões. Use com cuidado.', group: 'geral' },
  { key: 'manage_server', label: 'Gerenciar servidor', description: 'Alterar nome/imagem, ver e revogar convites, ver logs.', group: 'geral' },
  { key: 'manage_roles', label: 'Gerenciar cargos', description: 'Criar, editar e atribuir cargos abaixo do seu nível.', group: 'geral' },
  { key: 'manage_channels', label: 'Gerenciar canais', description: 'Criar, editar, ordenar e excluir canais e categorias.', group: 'geral' },
  { key: 'create_invite', label: 'Criar convites', description: 'Gerar links de convite.', group: 'geral' },
  { key: 'kick_members', label: 'Expulsar membros', description: 'Remover membros de nível inferior.', group: 'geral' },
  { key: 'ban_members', label: 'Banir membros', description: 'Banir e desbanir membros de nível inferior.', group: 'geral' },
  { key: 'send_messages', label: 'Enviar mensagens', description: 'Escrever em canais de texto.', group: 'texto' },
  { key: 'attach_files', label: 'Anexar arquivos', description: 'Enviar imagens e arquivos.', group: 'texto' },
  { key: 'add_reactions', label: 'Adicionar reações', description: 'Reagir com emojis.', group: 'texto' },
  { key: 'mention_everyone', label: 'Mencionar @everyone', description: 'Notificar todos os membros do canal.', group: 'texto' },
  { key: 'manage_messages', label: 'Gerenciar mensagens', description: 'Apagar mensagens de outros e fixar mensagens.', group: 'texto' },
  { key: 'connect_voice', label: 'Conectar à voz', description: 'Entrar em canais de voz.', group: 'voz' },
  { key: 'speak', label: 'Falar', description: 'Transmitir áudio do microfone.', group: 'voz' },
  { key: 'video', label: 'Câmera', description: 'Transmitir vídeo da câmera.', group: 'voz' },
  { key: 'screen_share', label: 'Compartilhar tela', description: 'Transmitir tela, janela ou aba.', group: 'voz' },
]

/** Contexto de permissões no cliente. Serve só para exibir/ocultar controles — a validação real é no banco. */
export interface PermContext {
  server: Server
  roles: Role[]
  member: Member | undefined
}

export function memberRoles(ctx: Pick<PermContext, 'roles' | 'member'>): Role[] {
  if (!ctx.member) return []
  const ids = new Set(ctx.member.member_roles.map((r) => r.role_id))
  return ctx.roles.filter((r) => r.is_default || ids.has(r.id))
}

export function hasPerm(ctx: PermContext | undefined, perm: string): boolean {
  if (!ctx || !ctx.member) return false
  if (ctx.server.owner_id === ctx.member.user_id) return true
  return memberRoles(ctx).some((r) => r.permissions.includes('administrator') || r.permissions.includes(perm))
}

export function topPosition(ctx: Pick<PermContext, 'roles' | 'member'> & { server: Server }, userId?: string): number {
  if (ctx.server.owner_id === (userId ?? ctx.member?.user_id)) return Number.MAX_SAFE_INTEGER
  return Math.max(0, ...memberRoles(ctx).map((r) => r.position))
}

export function highestRole(roles: Role[], member: Member): Role | undefined {
  const ids = new Set(member.member_roles.map((r) => r.role_id))
  return roles.filter((r) => ids.has(r.id) && !r.is_default).sort((a, b) => b.position - a.position)[0]
}
