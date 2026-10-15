# Backups e recuperação

O plano gratuito do Supabase **não inclui backups automáticos restauráveis** — faça os seus.

## Banco (texto, contas de perfil, servidores…)
```bash
npx supabase db dump --linked -f backup-$(date +%F).sql          # esquema + dados públicos
npx supabase db dump --linked --data-only -f dados-$(date +%F).sql
```
Ou `pg_dump` com a *connection string* (Project Settings → Database). Guarde fora do repositório (contém mensagens).
Contas (e-mails/senhas) ficam no schema `auth`; para incluí-las use `pg_dump` completo com o usuário `postgres`.

## Arquivos (Storage)
Baixe os buckets `public-media` e `attachments` pelo painel ou via CLI: `npx supabase storage cp -r ss:///attachments ./backup-attachments --linked`.

## Restaurar
1. Novo projeto Supabase → aplique as migrations (`db push`).
2. `psql "$CONNECTION_STRING" -f dados-AAAA-MM-DD.sql` (dados).
3. Reenvie os arquivos para os buckets mantendo os caminhos.
4. Republique as Edge Functions e os secrets; atualize as variáveis `VITE_*`.

## Rotina sugerida
Semanal (e antes de mudanças de esquema). Teste a restauração em um projeto vazio pelo menos uma vez.
