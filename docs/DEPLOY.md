# Deploy e distribuição

## Web — Cloudflare Pages (gratuito)
O app é um SPA estático (`dist/`); o backend é o Supabase, então o Pages basta.
1. Suba o repositório no GitHub.
2. Cloudflare → *Workers & Pages → Create → Pages → Connect to Git*.
3. Build command `npm run build`, output `dist`, Node 22+.
4. *Environment variables* (públicas): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_APP_URL` (a URL `https://<projeto>.pages.dev`).
5. `public/_redirects` já faz o fallback do SPA; `public/_headers` define cabeçalhos de segurança e `Permissions-Policy` liberando câmera/microfone/tela para o próprio site.
6. Atualize o *Site URL/Redirect URLs* do Supabase (SETUP.md §3).

O domínio gratuito `*.pages.dev` já é HTTPS (obrigatório para microfone/câmera/tela). Domínio próprio é opcional.

### Compartilhar com amigos
Envie o link do app + um link de convite (`…/invite/CÓDIGO`). Quem abrir sem conta é levado a criar uma e volta ao convite.

## Desktop — instalador Windows
Ver [DESKTOP.md](DESKTOP.md). Distribua o `.exe` NSIS por **GitHub Releases** (gratuito): o workflow `release-desktop.yml` compila ao criar uma tag `vX.Y.Z`.
Sem assinatura de código o Windows SmartScreen mostra aviso (“Mais informações → Executar assim mesmo”). Certificado de assinatura é pago; não é requisito.

## Atualizações do app
Não há auto-update configurado (exigiria chaves de assinatura do updater e um endpoint de releases). Envie o novo instalador; a instalação por cima preserva dados. O app web atualiza sozinho a cada deploy.
