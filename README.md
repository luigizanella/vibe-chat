# Vibe Chat

Plataforma de comunicação privada para grupos pequenos (5–10 pessoas): servidores, canais de texto e voz, mensagens em tempo real, amigos/DMs, cargos e permissões, voz/vídeo/compartilhamento de tela (LiveKit) e app Windows (Tauri). Identidade própria, estrutura de uso familiar.

**Stack:** React + TypeScript (strict) + Vite + Tailwind · Supabase (Auth, Postgres+RLS, Realtime, Storage, Edge Functions) · LiveKit · Tauri · custo-alvo R$ 0.

## Começar
1. [docs/SETUP.md](docs/SETUP.md) — Supabase, migrations, funções, variáveis
2. [docs/LIVEKIT.md](docs/LIVEKIT.md) — voz/vídeo/tela (Cloud grátis × auto-hospedado)
3. `npm install && npm run dev`

## Documentação
[ARCHITECTURE](docs/ARCHITECTURE.md) · [DEPLOY](docs/DEPLOY.md) · [DESKTOP](docs/DESKTOP.md) · [COSTS](docs/COSTS.md) · [BACKUP](docs/BACKUP.md) · [TESTING](docs/TESTING.md) · [TODO](TODO.md)

## Estado honesto
Código, migrations, RLS e testes de isolamento (63 testes) estão prontos e passam; lint, typecheck e build de produção passam. **Voz/vídeo/tela e os fluxos contra o Supabase real ainda não foram exercitados** (dependem das suas credenciais e de dois dispositivos) — veja o roteiro em [docs/TESTING.md](docs/TESTING.md). O build Tauri não foi executado aqui.

Não usa marca, logotipos ou ativos do Discord.
