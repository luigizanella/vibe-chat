# Instalação e configuração (do zero, custo R$ 0)

Pré-requisitos: Node.js 22+ (testado com 24), Git. Opcionais: Docker (LiveKit local), Rust + Build Tools (app desktop).

## 1. Projeto Supabase (gratuito, sem cartão)
1. Crie uma conta em <https://supabase.com> e um projeto (região mais próxima: *South America (São Paulo)*).
2. **Project Settings → API**: copie *Project URL* e a chave *anon/publishable*.
3. Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
   A chave `service_role` **nunca** vai para o frontend.

## 2. Migrations (banco, RLS, storage, realtime)
Com o Supabase CLI (`npx supabase`):
```bash
npx supabase login
npx supabase link --project-ref SEU_REF
npx supabase db push        # aplica supabase/migrations/0001…0010 em ordem
```
Alternativa sem CLI: no **SQL Editor** do painel, execute cada arquivo de `supabase/migrations/` **na ordem numérica**.

Depois confirme no painel:
- **Database → Replication**: tabelas `messages`, `reactions`, `members`… estão na publicação `supabase_realtime` (a migration 0007 faz isso).
- **Storage**: buckets `public-media` (público) e `attachments` (privado).
- **Realtime → Settings**: marque **“Allow public access” = desligado** (usamos canais *privados* com RLS em `realtime.messages`). Se o painel oferecer “Enable Realtime Authorization / private channels only”, ative.

## 3. Autenticação
**Authentication → URL Configuration**
- *Site URL*: a URL pública do app (ex.: `https://vibe-chat.pages.dev`; em dev `http://localhost:5173`).
- *Redirect URLs*: adicione `http://localhost:5173/**`, a URL pública `/**`, `tauri://localhost/**` e `http://tauri.localhost/**`.

**Authentication → Providers → Email**: mantenha e-mail+senha habilitado. *Confirm email*:
- Ligado (recomendado em produção): o plano gratuito usa um SMTP de teste com **limite muito baixo de e-mails/hora**; para grupo pequeno, configure seu próprio SMTP (ex.: Gmail app password / Brevo free) em *Auth → SMTP Settings*.
- Desligado: cadastro entra direto (mais simples para 5–10 amigos, menos seguro).

Recuperação de senha e troca de e-mail usam os templates/SMTP desse mesmo painel.

## 4. Edge Functions (voz e exclusão de conta)
```bash
npx supabase secrets set LIVEKIT_URL=wss://SEU-SERVIDOR LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...
npx supabase functions deploy livekit-token
npx supabase functions deploy delete-account
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente dentro das funções. Obtenha os dados do LiveKit em [LIVEKIT.md](LIVEKIT.md).
Sem esses secrets, entrar em voz mostra “LiveKit não está configurado” (comportamento esperado).

## 5. Rodar localmente
```bash
npm install
npm run dev          # http://localhost:5173
```
Crie sua conta, depois um servidor. Convide amigos em *Servidor → Convidar pessoas*.

## 6. Verificação
Abra **Configurações → Diagnóstico**: testa rede, banco, sessão, Realtime, função de voz, WebRTC, tela e notificações.

## Comandos úteis
| Comando | O que faz |
|---|---|
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript estrito |
| `npm test` | unitários + testes de RLS/RPC (PostgreSQL real via PGlite) |
| `npm run build` | build de produção em `dist/` |
| `npm run dev:visual` | UI com backend **simulado no navegador** só para inspeção de layout (não é o produto) |
| `npm run desktop:dev` / `desktop:build` | app Tauri (ver DESKTOP.md) |
