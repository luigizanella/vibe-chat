# Voz, vídeo e tela com LiveKit — duas opções avaliadas

O app usa WebRTC via LiveKit. O token de acesso é emitido pela Edge Function `livekit-token`, que **valida no banco** (RPC `voice_access`, com o JWT do usuário) se ele pode entrar no canal e quais fontes pode publicar (microfone/câmera/tela). O segredo `LIVEKIT_API_SECRET` só existe como *secret* da função.

## A. LiveKit Cloud — plano gratuito (Build)
Segundo a [página de preços](https://livekit.com/pricing.md) e as [cotas](https://docs.livekit.io/cloud/quotas-and-limits) (conferidas em out/2026; confirme antes de contar com elas):
- 5.000 minutos de participante WebRTC/mês, 50 GB de saída/mês, 100 conexões simultâneas, sem cartão.
- Passou da cota: **novas conexões falham até o mês virar**.

**É suficiente?** 5 pessoas × 1 h = 300 min por sessão → ~16 sessões/mês. 10 pessoas × 2 h = 1.200 min → ~4 sessões. Câmera e tela consomem banda (50 GB cobrem bastante, mas 1080p com 10 espectadores gasta rápido). Bom para começar/testar; apertado para uso diário intenso.

Passos: criar conta em livekit.io → projeto → *Settings → Keys* → copie `wss://xxxx.livekit.cloud`, API Key e Secret → `supabase secrets set …` (ver SETUP.md). Funciona de qualquer rede, sem abrir portas, com HTTPS/TURN prontos.

## B. LiveKit auto-hospedado no seu PC (Docker)
Arquivos em `infra/livekit/`. **Não é plug-and-play para amigos fora da sua casa.** Requisitos reais:

| Requisito | Detalhe |
|---|---|
| IP público | Seu provedor não pode usar **CGNAT** (veja se o IP do roteador ≠ IP que sites mostram). Com CGNAT, conexões externas **não funcionam** sem VPS. |
| Roteador | Encaminhar: TCP 7880 (ou 443 via Caddy), TCP 7881, UDP 3478 e UDP 50000–50100 para o PC. |
| Firewall do Windows | Liberar as mesmas portas. |
| HTTPS/WSS | Se o app web está em `https://`, o navegador **exige `wss://`** (mixed content). Precisa de domínio + certificado (Caddy automático; domínio grátis tipo DuckDNS aponta para IP dinâmico). Dependem de domínio: HTTPS do LiveKit e TURN/TLS. |
| TURN | Redes restritivas (corporativas, 4G com NAT simétrico) só conectam via TURN. O LiveKit tem TURN embutido, mas precisa de domínio+certificado. |
| Disponibilidade | O PC precisa estar **ligado e com Docker rodando** durante as chamadas; IP dinâmico muda → atualizar DNS. |
| Banda de subida | O servidor retransmite (SFU): para 10 pessoas com vídeo, subida da sua casa pode saturar. Áudio apenas é leve (~30 kbps por pessoa por fluxo). |
| Segurança | Expõe seu IP residencial e portas à Internet; mantenha a imagem atualizada e use chaves fortes. |
| Windows/Docker Desktop | Sem rede *host*: usamos faixa UDP pequena publicada. O ICE pode anunciar IP errado; defina `rtc.node_ip` (LAN) ou `use_external_ip` (Internet). |

Teste só em casa (LAN): `node_ip` = IP LAN do PC, `LIVEKIT_URL=ws://IP-LAN:7880`, app aberto via `http://localhost` ou IP LAN (microfone exige contexto seguro; `localhost` conta). Amigos fora de casa: use a opção A, ou um servidor externo.

**Se for necessário hospedagem externa** e você não quiser pagar: não existe opção gratuita *persistente e confiável* de VPS com UDP que eu possa garantir (ofertas “always free” de provedores têm cadastro com cartão, cotas e mudam). Por isso a recomendação é: **A para o grupo remoto; B para laboratório/LAN**. Cloudflare Tunnel (gratuito) **não** transporta UDP/WebRTC, então não resolve a mídia.

## Gerar chaves (opção B)
```bash
docker run --rm livekit/livekit-server generate-keys
```
Coloque em `infra/livekit/livekit.yaml` e nos secrets da função.

## Teste manual de voz
Veja `docs/TESTING.md` §Voz/Vídeo/Tela.
