# Vibe Chat

Plataforma de comunicação privada para grupos pequenos (5–10 pessoas): servidores, canais de texto e voz, mensagens em tempo real, amigos/DMs, cargos e permissões, voz/vídeo/compartilhamento de tela (LiveKit) e app Windows (Tauri) com auto-update. Identidade própria, estrutura de uso familiar. Não usa marca, logotipos ou ativos do Discord.

**Stack:** React + TypeScript (strict) + Vite + Tailwind · Supabase (Auth, Postgres+RLS, Realtime, Storage, Edge Functions) · LiveKit · Tauri · hospedagem gratuita (Vercel + GitHub Releases).

## Como o grupo usa
- **Navegador:** abrir o link do site → criar conta → entrar (ou abrir um link de convite `/invite/CÓDIGO`).
- **Windows:** na página inicial do site, botão **Baixar para Windows** (sempre a última versão do GitHub Releases). O instalador **não é assinado**: o SmartScreen pode avisar — clique em *Mais informações → Executar assim mesmo*. O app se atualiza sozinho.

## Instalar / publicar
1. [docs/SETUP.md](docs/SETUP.md) — Supabase, migrations, funções, variáveis
2. [docs/VERCEL.md](docs/VERCEL.md) — site gratuito (Vercel) e variáveis
3. [docs/LIVEKIT.md](docs/LIVEKIT.md) — voz/vídeo/tela
4. [docs/DESKTOP.md](docs/DESKTOP.md) — instalador Windows, releases e auto-update
5. Local: `npm install && npm run dev`

## Limites dos planos gratuitos (leia!)
- **Supabase grátis pausa o projeto após ~7 dias sem atividade** (dados são mantidos; é preciso clicar em *Restore* no painel). Também: ~500 MB de banco, ~1 GB de arquivos, ~5 GB de tráfego/mês, ~200 conexões Realtime. Se encher, escritas falham. Sem backups restauráveis automáticos → [docs/BACKUP.md](docs/BACKUP.md).
- **LiveKit Cloud grátis (Build):** 5.000 minutos de participante/mês, 50 GB de saída, 100 conexões. Passou disso, **novas chamadas falham até virar o mês** (5 pessoas × 1 h = 300 min). Detalhes em [docs/COSTS.md](docs/COSTS.md).
- **Confirmação de e-mail está desligada** para facilitar os testes: qualquer pessoa com o link do site pode criar conta (com e-mail falso, inclusive). Convites controlam *quem entra no servidor*, mas não quem cria conta. Quando o grupo estiver estável, ligue *Confirm email* (e configure SMTP próprio) e/ou desative novos cadastros em *Authentication → Sign In / Providers*.

## Segurança
`.env`, `.tokens.env`, `supabase/.secrets.env` e chaves estão no `.gitignore`. O cliente só usa a chave *publishable*; `LIVEKIT_API_SECRET` e `service_role` existem apenas como secrets das Edge Functions. Toda autorização é feita no banco (RLS + RPC) — ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testes
`npm run lint` · `npm run typecheck` · `npm test` (unit + 50 testes de RLS/RPC em PostgreSQL real/PGlite) · `npm run build` · `npm run test:e2e` (fumaça **real** contra o seu projeto Supabase: cadastro, RLS, Realtime, token LiveKit; cria e apaga contas de teste). Relatório honesto do que foi/não foi testado: [docs/TESTING.md](docs/TESTING.md). Pendências: [TODO.md](TODO.md).

Outros docs: [ARCHITECTURE](docs/ARCHITECTURE.md) · [DEPLOY](docs/DEPLOY.md) · [COSTS](docs/COSTS.md) · [BACKUP](docs/BACKUP.md)
