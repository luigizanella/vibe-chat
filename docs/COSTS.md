# Custos, cotas e riscos (meta: R$ 0)

Valores conferidos em out/2026 em páginas públicas e blogs; **confirme nos painéis oficiais** antes de depender deles.

| Componente | Gratuito? | Limites relevantes | Se acabar / pausar |
|---|---|---|---|
| Supabase (Auth, Postgres, Realtime, Storage, Edge Functions) | Sim, sem cartão | ~500 MB banco, ~1 GB arquivos, ~5 GB egress/mês, ~200 conexões Realtime, ~2 M mensagens Realtime/mês, 50 k MAU | Banco cheio → escritas falham (somente leitura). Egress acima → restrições/aviso. **Projeto pausa após ~7 dias sem atividade** e precisa ser retomado manualmente no painel. |
| Cloudflare Pages | Sim | Builds limitados/mês; tráfego estático generoso | Deploys param; site existente continua. |
| LiveKit Cloud (Build) | Sim | 5.000 min de participante/mês, 50 GB saída, 100 conexões | Novas chamadas **falham até virar o mês**. |
| LiveKit auto-hospedado | Software livre | Seu PC, sua banda, seu IP | Se o PC desliga, a voz cai. |
| GitHub (repo, Actions, Releases) | Sim | Minutos de Actions limitados em repositórios privados | CI/instalador param de ser gerados. |
| Tauri / Docker / Caddy / Rust | Livres | — | — |
| Domínio próprio | **Opcional e pago** | `*.pages.dev` e `*.supabase.co` bastam | — |

## O que precisa ficar ligado
- Nada no seu PC com a opção A (tudo gerenciado). Com a opção B: PC, Docker e rede o tempo todo.
- Para o projeto Supabase não pausar: use-o pelo menos 1×/semana (ou um *cron* externo gratuito que faça uma requisição).

## Consumo estimado (5–10 amigos)
- Texto: desprezível (KBs por mensagem). Anexos: cotas de storage/egress são o primeiro limite — fotos grandes enchem 1 GB rápido (limite de 25 MB por arquivo, 5 MB para avatares).
- Voz: ~30–50 kbps por fluxo; vídeo 720p ≈ 1–2 Mbps por fluxo; tela 1080p30 ≈ 3,5 Mbps (limite configurado).

## Exigências de rede
HTTPS/WSS de saída (443) para Supabase/LiveKit; UDP aberto melhora a qualidade (senão cai em TURN/TCP). Em redes corporativas restritas a voz pode falhar.

## Riscos de hospedar tudo no seu computador
Exposição do IP residencial; CGNAT impede acesso externo; consumo de banda de subida; queda se o PC desliga/hiberna; IP dinâmico; Windows Update reinicia; sem redundância/backup; responsabilidade por patches de segurança. Por isso a recomendação é **Supabase + Pages + LiveKit Cloud** (ou VPS futuro) e usar o PC apenas para desenvolvimento.

## Recursos que dependem de domínio próprio
Apenas: TURN/TLS e WSS do LiveKit *auto-hospedado*, e e-mail com remetente personalizado. O restante funciona com subdomínios gratuitos.
