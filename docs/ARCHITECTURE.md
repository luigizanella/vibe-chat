# Arquitetura e decisões

```
Navegador / Tauri (React+TS+Vite+Tailwind)
   │  supabase-js (Auth, PostgREST, Realtime, Storage)        livekit-client (WebRTC)
   ▼                                                              ▲
Supabase ── Postgres (RLS + RPC SECURITY DEFINER) ── Realtime      │ token
        └─ Edge Functions: livekit-token ─────────────────────────┘
                           delete-account (service_role)
LiveKit (Cloud free ou Docker) ── mídia (voz/vídeo/tela)
```

## Decisões
- **Autorização no banco.** Toda escrita sensível é uma RPC `SECURITY DEFINER` que checa permissões e hierarquia; tabelas só têm políticas de `SELECT` (exceções: próprio perfil, preferências). Helpers ficam no schema `private` (não exposto pela API).
- **Isolamento.** `can_view_channel`/`can_read_scope` governam mensagens, anexos, reações, Storage e Realtime. Canais privados: sobrescritas por cargo/usuário (usuário > cargo; “permitir” vence “negar” entre cargos).
- **Hierarquia.** `top_position`: dono = ∞; só se modera/atribui o que está estritamente abaixo; concessão de permissões limitada às que o ator possui; moderador não toca em dono/administrador.
- **Mensagens.** Sem `INSERT` direto: `send_message` valida acesso, bloqueios, limite de taxa (15/10 s), anexos (caminho precisa começar com `c|d/<escopo>/<uid>/`), extrai menções no servidor e é idempotente (id gerado no cliente → reenvio seguro).
- **Tempo real.** `postgres_changes` (filtrado por RLS) para dados; Presence + Broadcast em canais **privados** (`srv:`, `fr:`, `chan:`, `dm:`) autorizados por policies em `realtime.messages`. Presença expira com a desconexão; “invisível” não publica presença.
- **Voz.** `livekit-token` chama `voice_access` com o JWT do usuário; token de 1 h, `canPublishSources` limitado às permissões do cargo; sala `vc_<canal>`. Porta de ruído (sensibilidade) via processador WebAudio local; mute/PTT na própria track.
- **Storage.** `public-media` (avatares/banners/ícones; público, nomes com UUID) e `attachments` (privado, URLs assinadas de 1 h; política de leitura = acesso ao canal/DM).
- **Segredos.** Frontend só conhece URL + anon key. `LIVEKIT_API_SECRET` e `service_role` ficam em secrets das Edge Functions.
- **Estado no cliente.** Zustand (UI, sessão, configurações, voz) + TanStack Query (dados do servidor, atualizados por Realtime).
- **Configurações.** Persistidas localmente e sincronizadas em `user_prefs.settings` (dispositivos de áudio/vídeo só locais).

## Limitações conhecidas (honestas)
- Threads (respostas encadeadas) **não implementadas** — há respostas/citações.
- Chamadas de voz/vídeo em DMs não implementadas (voz só em canais de servidor).
- Moderar voz (silenciar/desconectar outro usuário no LiveKit) não implementado.
- Idioma: apenas pt-BR.
- Arquivos do Storage de canais/servidores apagados ficam órfãos no bucket (o banco não deixa referências órfãs); limpeza periódica manual — ver TODO.md.
- Sem busca full-text avançada: usa `ILIKE` (≥ 2 caracteres).
- Sem push notifications com o app fechado (só notificações com o app aberto/na bandeja).
- Sem auto-update do desktop.
