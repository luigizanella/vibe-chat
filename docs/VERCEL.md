# Site gratuito na Vercel

O `vercel.json` já define build (`npm run build`), saída (`dist`), **fallback de SPA** (F5 em qualquer URL funciona) e cabeçalhos de segurança, incluindo `Permissions-Policy` que libera câmera, microfone e compartilhamento de tela para o próprio site (HTTPS é fornecido pela Vercel — requisito do navegador para essas APIs).

## Passo a passo
1. <https://vercel.com> → **Sign Up** com sua conta do GitHub (plano *Hobby*, gratuito, sem cartão).
2. **Add New… → Project** → importe `luigizanella/vibe-chat`. Framework: *Vite* (detectado). Não mude build/output.
3. Em **Environment Variables**, adicione (Production, Preview e Development):

| Nome | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://dpvyyedihpqnnsqvhuvo.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | a chave *publishable* (a mesma do seu `.env`) |
| `VITE_PUBLIC_APP_URL` | a URL final do site, ex. `https://vibe-chat.vercel.app` (preencha após o 1º deploy e faça *Redeploy*) |

   Nunca coloque `service_role` nem segredo do LiveKit na Vercel.
4. **Deploy**. Anote a URL.
5. **Supabase → Authentication → URL Configuration**: *Site URL* = URL da Vercel; em *Redirect URLs* acrescente `https://SUA-URL.vercel.app/**` (mantenha `http://localhost:5173/**`, `tauri://localhost/**`, `http://tauri.localhost/**`).
6. **GitHub → repositório → Settings → Secrets and variables → Actions**: crie/atualize `VITE_PUBLIC_APP_URL` com a mesma URL (usado no instalador Windows para gerar links de convite).

Limites do plano Hobby: uso pessoal/não comercial, 100 GB de banda/mês — sobra para o grupo.
