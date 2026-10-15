/** Converte erros do Supabase/RPC/rede em mensagens compreensíveis (pt-BR). */
const MAP: [RegExp, string][] = [
  [/rate_limited|too many requests|429/i, 'Muitas ações em pouco tempo. Aguarde alguns segundos e tente novamente.'],
  [/owner_cannot_leave/, 'O dono não pode sair do servidor. Transfira a propriedade ou exclua o servidor.'],
  [/banned/, 'Você está banido deste servidor.'],
  [/invite_invalid/, 'Convite inválido, expirado, revogado ou sem usos restantes.'],
  [/requests_closed/, 'Este usuário não está aceitando pedidos de amizade.'],
  [/dm_closed/, 'Este usuário não aceita mensagens diretas suas.'],
  [/blocked/, 'Ação indisponível: há um bloqueio entre vocês.'],
  [/limit_reached/, 'Limite atingido para esta ação.'],
  [/forbidden|42501|row-level security|permission denied/i, 'Você não tem permissão para fazer isso.'],
  [/not_found|P0002/, 'Item não encontrado (pode ter sido removido).'],
  [/invalid_input|22023/, 'Dados inválidos. Revise o que foi informado.'],
  [/duplicate key|already exists|23505/, 'Este valor já está em uso.'],
  [/profiles_username_format/, 'Nome de usuário inválido: use 2–32 letras minúsculas, números, "_" ou ".".'],
  [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/Email not confirmed/i, 'Confirme seu e-mail antes de entrar (verifique a caixa de entrada e o spam).'],
  [/User already registered|already been registered/i, 'Já existe uma conta com este e-mail.'],
  [/Password should be at least|weak_password/i, 'Senha fraca: use pelo menos 8 caracteres.'],
  [/same_password|different from the old/i, 'A nova senha precisa ser diferente da atual.'],
  [/email rate limit|over_email_send_rate_limit/i, 'Limite de e-mails atingido. Tente novamente em alguns minutos.'],
  [/Failed to fetch|NetworkError|Load failed|fetch failed/i, 'Sem conexão com o servidor. Verifique sua internet.'],
  [/JWT expired|invalid JWT|refresh_token/i, 'Sua sessão expirou. Entre novamente.'],
]

export function errorMessage(e: unknown, fallback = 'Algo deu errado. Tente novamente.'): string {
  const raw =
    typeof e === 'string' ? e : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : ''
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code ?? '') : ''
  const hay = `${raw} ${code}`
  for (const [re, msg] of MAP) if (re.test(hay)) return msg
  return raw && raw.length < 140 && !/[{}]/.test(raw) ? raw : fallback
}

export function isRateLimited(e: unknown): boolean {
  return /rate_limited|P0429|429/.test(errorMessage(e) + JSON.stringify(e ?? ''))
}
