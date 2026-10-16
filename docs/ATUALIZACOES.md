# Atualização automática e lançamento de versões

## Como lançar
```
npm run release -- patch      # 0.2.0 -> 0.2.1  (também: minor, major ou 1.4.0)
npm run release -- patch --dry   # só mostra o que faria
```
O comando exige árvore git limpa e branch `main`. Ele sobe a versão em `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml`, commita, cria a tag `vX.Y.Z`, envia o branch e a tag e dispara o workflow "Release desktop" (usa `GITHUB_TOKEN` de `.tokens.env`; neste repositório eventos de tag não disparam o Actions sozinhos).

## O que acontece depois
| Parte | Como atualiza | Tempo esperado (estimativa, não medido nesta rodada) |
|---|---|---|
| Web (Vercel) | O push na main faz o deploy; cada build publica `/version.json`. O app aberto confere a cada 5 min (e ao voltar para a aba) e recarrega sozinho. | deploy ~1 min + até 5 min de checagem |
| Desktop | Ao abrir e a cada 30 min o app consulta `latest.json` no GitHub Releases, baixa em segundo plano e instala/reinicia sozinho. | build do instalador ~10-15 min + até 30 min de checagem |

## Durante uma chamada
Nada reinicia no meio da chamada. Quando a atualização está pronta, aparece o aviso "Reiniciar agora" (que você pode clicar quando quiser); ao sair da chamada ela é aplicada sozinha. A sessão (login) fica salva no navegador/app, então tudo volta logado.

## Limites
- O instalador não é assinado pelo Windows (SmartScreen), mas a atualização é verificada pela assinatura do updater do Tauri (chave em `src-tauri/.updater-private.key`, fora do git).
- Só funciona a partir da primeira versão que tem este código: instale o app uma vez manualmente para começar a receber atualizações automáticas completas.
