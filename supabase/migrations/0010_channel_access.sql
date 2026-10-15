-- ============================================================================
-- 0010_channel_access.sql — Permite ao cliente saber (só para a UI) se o usuário
-- atual pode enviar mensagens num canal, considerando cargos e sobrescritas.
-- A autorização real continua em send_message / RLS.
-- ============================================================================

create or replace function public.can_send_in_channel(p_channel uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid := private.require_uid();
begin
  return private.can_use_channel(p_channel, uid);
end $$;

revoke all on function public.can_send_in_channel(uuid) from public, anon;
grant execute on function public.can_send_in_channel(uuid) to authenticated;
