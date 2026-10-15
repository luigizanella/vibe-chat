# Aplicativo Windows (Tauri)

O app desktop é a **mesma interface web** empacotada; continua usando o Supabase/LiveKit remotos (nenhum banco local).

## Pré-requisitos (uma vez)
1. Rust: <https://rustup.rs> (toolchain *stable-msvc*).
2. **Microsoft C++ Build Tools** (workload “Desenvolvimento para desktop com C++”).
3. WebView2 (já vem no Windows 11).
4. `npm install`.

## Comandos
```bash
npm run desktop:dev      # janela de desenvolvimento com hot-reload
npm run desktop:build    # gera o instalador NSIS
```
Saída: `src-tauri/target/release/bundle/nsis/Vibe Chat_0.1.0_x64-setup.exe` (instala por usuário, sem admin).
Defina `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_PUBLIC_APP_URL` no ambiente/`.env.local` **antes** do build: são embutidas no app.

Para trocar o ícone: substitua `src-tauri/app-icon.png` (1024×1024) e rode `npx tauri icon src-tauri/app-icon.png`.

## Recursos configurados
- Bandeja do sistema (abrir/sair), **fechar = minimizar para bandeja** (configurável), instância única.
- Iniciar com o Windows (plugin autostart; inicia oculto na bandeja).
- Notificações nativas (plugin notification).
- Permissões de microfone/câmera/tela: o WebView2 pergunta ao usuário na primeira vez. Compartilhamento de tela via `getDisplayMedia` mostra o seletor do WebView2.
- CSP restritiva em `tauri.conf.json` (conecta apenas a `https:`/`wss:` e localhost).

## Limitações conhecidas
- **Push-to-talk só com a janela em foco** (não há atalho global do SO). Um atalho global exigiria o plugin `global-shortcut`; fica como evolução.
- Áudio do sistema no compartilhamento de tela depende do WebView2/Windows; **não foi testado** aqui (veja TESTING.md).
- Links de e-mail (confirmação/recuperação) abrem no navegador, na URL web pública — por isso `VITE_PUBLIC_APP_URL` é necessária.
- O build desktop **não foi executado** neste ambiente (Rust não instalado); o workflow do GitHub Actions o compila em runner Windows.
