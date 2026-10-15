# Testes — o que foi executado e o que falta validar manualmente

## Executado automaticamente (resultado real em 15/10/2026)
`npm run lint` ✔ sem avisos · `npm run typecheck` ✔ · `npm test` ✔ **63 testes** · `npm run build` ✔

| Suíte | O que cobre |
|---|---|
| `tests/db/migrations.test.ts` | Migrations aplicam do zero em PostgreSQL real (PGlite); toda tabela pública tem RLS. |
| `tests/db/security.test.ts` (43) | Isolamento entre servidores; canais privados (leitura, envio, busca); sobrescritas por cargo/usuário; escrita direta negada; anônimo negado; mensagens (edição/exclusão/idempotência/menções/limite de taxa/anexos com path forjado e traversal); reações; fixadas; políticas de **Storage** (anexos e mídia); hierarquia de cargos e moderação (moderador não bane admin/dono, sem autopromoção, concessão limitada às próprias permissões); convites (expirado, limite de usos, revogado, banido); amigos/bloqueios/DMs/política de DM; privacidade de perfis; unicidade de username; tópicos Realtime; cascata de exclusão; exclusão de conta; conta desativada. |
| `tests/db/voice.test.ts` | `voice_access` (base do token LiveKit): membro ok; forasteiro, canal privado, canal de texto e anônimo negados; permissões de falar/vídeo/tela refletem cargos; limite de taxa; `can_send_in_channel`. |
| `tests/unit/logic.test.tsx` | Markdown sem XSS, conversão de menções, permissões do cliente, mensagens de erro, atalhos, validação de imagem. |

Limitação: PGlite valida **SQL/RLS/RPC**; não exercita o PostgREST, o Realtime nem o Auth reais.

## Verificação visual (parcial)
Com `npm run dev:visual` (backend simulado no navegador, só fixtures de teste) foram inspecionados: login, canal de texto, canal de voz (estado de erro “LiveKit não configurado”), lista de amigos, DMs, configurações e layout a 375 px (sem rolagem horizontal). Não substitui teste com backend real.

## NÃO executado (precisa de credenciais/dispositivos) — procedimento manual
Marque cada item após executar com **duas contas em dois navegadores/dispositivos**.

### Fluxos de conta e dados (requer projeto Supabase)
1. Cadastro → confirmar e-mail (se ativo) → login → logout → sessão persiste após recarregar.
2. “Esqueci a senha” → link do e-mail → nova senha → login.
3. Editar perfil (avatar/banner/bio/username duplicado deve falhar), status, privacidade.
4. Criar servidor → convidar (link) → 2ª conta entra → criar canais/categorias → arrastar para reordenar.
5. Mensagens em tempo real A↔B; recarregar e ver histórico; editar/apagar/reagir/fixar/responder; anexos (imagem/arquivo); busca; indicador de digitação; menção gera badge e notificação.
6. Canal privado: a 2ª conta não vê o canal nem mensagens; liberar via Permissões → passa a ver.
7. Cargos: criar cargo, atribuir, conferir limites do moderador; expulsar/banir/desbanir.
8. Presença: fechar a aba da conta B → em até ~1 min ela aparece offline na conta A.
9. Excluir conta (função `delete-account` publicada) e desativar/reativar.

### Voz, vídeo, tela (requer LiveKit + função `livekit-token`)
10. Duas contas entram no mesmo canal de voz; lista de participantes real; fala → indicador de falando nos dois lados (áudio **audível**, usar fones).
11. Mutar/ensurdecer; volume por participante; trocar microfone/saída; push-to-talk; sensibilidade manual.
12. Câmera: ligar em A, ver em B; grade com 3+ participantes; destaque; tela cheia.
13. Compartilhar tela inteira / janela / aba; B vê; parar pelo botão e pelo botão do navegador; **áudio do sistema**: marcar a opção no seletor (Chrome/Edge, tela inteira/aba) e confirmar que B ouve — se o aviso “sem áudio do sistema” aparecer, o navegador não forneceu.
14. Derrubar a rede de A por 20 s (modo avião/desativar Wi-Fi) → banner “Reconectando” → volta sozinho; fechar/abrir aba → sai e entra de novo.
15. Negar permissão de microfone/câmera/tela → mensagem clara, chamada continua como ouvinte.
16. 5 e 10 participantes: observar CPU/banda; reduzir qualidade em Voz e vídeo se necessário.

### Layout
17. Redimensionar de 320 px a 1920 px; testar telefone real; teclado: Tab/Enter/Esc nos modais e menus; leitor de tela básico.

### Build desktop
18. `npm run desktop:build` em Windows com Rust → instalar o `.exe`, testar bandeja, autostart, notificações, microfone/câmera/tela no WebView2.
