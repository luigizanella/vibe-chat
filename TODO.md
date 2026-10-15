# TODO / progresso real

Legenda: ✅ feito e verificado · 🟡 implementado, **não verificado com backend/dispositivos reais** · ⛔ não implementado

## Banco e segurança
- ✅ 10 migrations (schema, helpers, RLS, RPCs, storage, realtime, grants) — aplicam em PostgreSQL real (PGlite) e 50 testes de acesso passam
- 🟡 Realtime Authorization (`realtime.messages`) e Storage policies: testadas só com stubs; validar no projeto Supabase real
- ⛔ Limpeza de arquivos órfãos no Storage ao excluir canal/servidor

## Frontend
- ✅ Auth (login, registro com checagem de username, recuperação, redefinição, onboarding, conta desativada) — 🟡 fluxos reais de e-mail
- ✅ Servidores, convites, canais/categorias (DnD), cargos/permissões, moderação, permissões por canal — 🟡 contra backend real
- ✅ Mensagens (envio otimista/retry, edição, exclusão, respostas, reações, fixadas, anexos, menções, busca, digitação, paginação) — 🟡
- ✅ Amigos, bloqueios, DMs, grupos — 🟡
- ✅ Configurações (conta, perfil, privacidade, aparência, notificações, voz/vídeo, atalhos, desktop, diagnóstico)
- 🟡 Voz/vídeo/tela com LiveKit (implementado; **nunca conectado a um servidor LiveKit real**)
- ⛔ Threads, chamadas em DM, moderação de voz, i18n além de pt-BR, push com app fechado
- ⛔ Atalho de push-to-talk global (só com foco)

## Desktop / infra
- 🟡 Tauri configurado (tray, autostart, notificações, instância única, ícones) — **build não executado** (sem Rust no ambiente)
- ✅ Docker Compose LiveKit + Caddy (exemplo) — 🟡 não executado
- ✅ CI (GitHub Actions) e release Windows — 🟡 não executados

## Próximos passos sugeridos
1. Criar o projeto Supabase, aplicar migrations, publicar funções (docs/SETUP.md).
2. Criar projeto LiveKit Cloud e testar voz com 2 contas (docs/TESTING.md §10–16).
3. Rodar `desktop:build` em Windows com Rust.
4. Cron semanal de backup e de “ping” para evitar pausa do projeto.
