# TODO / progresso real (atualizado após testes no Supabase/LiveKit reais)

✅ verificado de verdade · 🟡 implementado, não verificado · ⛔ não implementado

## Verificado contra o projeto real (npm run test:e2e + navegador)
- ✅ Migrations 0001–0010 aplicadas; Realtime (publicação + policies) e buckets conferidos
- ✅ Cadastro/login por e-mail+senha (confirmação desligada), perfil por trigger, onboarding, criar servidor, convite, mensagens persistentes (UI)
- ✅ RLS: forasteiro não lê/envia/vê servidor; INSERT direto negado; membro não cria canal; Realtime privado nega quem não tem acesso
- ✅ Edge Functions publicadas; token LiveKit emitido só para quem tem acesso (negado a forasteiro/sem login), com fontes de mídia limitadas
- ✅ Duas contas no mesmo canal de voz (LiveKit Cloud): conexão, lista de participantes e presença reais
- ✅ Build web, build do instalador Windows local (assinado para auto-update)

## Não verificado (precisa de dispositivos/ações suas)
- 🟡 Áudio audível entre duas pessoas, câmera, compartilhamento de tela e áudio do sistema (o painel de teste bloqueia mic/câmera/tela)
- 🟡 Instalador instalado e aberto no Windows; auto-update de verdade (precisa de duas versões publicadas)
- 🟡 GitHub Actions (nenhuma execução apareceu — ver instruções de entrega)
- 🟡 Deploy na Vercel (depende de você conectar o repositório)

## Não implementado
- ⛔ Threads, chamadas em DM, moderação de voz, i18n além de pt-BR, push com app fechado, PTT global, limpeza de arquivos órfãos no Storage
