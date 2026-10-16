# Roteiro de teste: supressão de ruído e sensibilidade

Precisa de duas pessoas (ou duas abas/computadores) na mesma chamada. Use fones para não gerar eco.
O navegador não deixa automatizar microfone real, por isso estes testes são manuais.

## O que foi implementado
- Cadeia de áudio única (`src/lib/micProcessor.ts`): microfone, passa-alta 90 Hz, RNNoise (modo "Alta"), medidor, porta de ruído, saída.
- Na chamada ela é registrada como processador da faixa da LiveKit. A faixa publicada é a que sai da cadeia.
- O teste de microfone nas configurações usa exatamente a mesma cadeia.
- Em Configurações, Voz e vídeo, a linha "Diagnóstico da chamada" confirma que a faixa enviada passa pelo filtro.

## Teste 1: ruído de teclado com supressão "Alta"
1. Pessoa A entra numa chamada. Em Voz e vídeo escolha "Supressão de ruído: Alta" e deixe a sensibilidade automática ligada.
2. Confira o diagnóstico: deve dizer "a faixa enviada passa pelo filtro" e "RNNoise + porta de ruído".
3. A digita forte no teclado, perto do microfone, por 10 segundos, sem falar.
4. Esperado: B não ouve as teclas (ou ouve muito baixo). O medidor da barra de voz de A quase não acende.
5. A fala normalmente: B ouve sem cortes no começo das palavras.

## Teste 2: sensibilidade manual no máximo
1. Desligue "Sensibilidade de entrada automática" e arraste o limite para 100.
2. Clique em "Testar microfone": o traço do limite fica na ponta direita da barra.
3. Digite, bata na mesa e fale em tom normal. Esperado: nada passa ("Silêncio / ruído filtrado"). Só grito muito próximo do microfone abre a porta.
4. Leve o limite a 0: tudo passa ("envia tudo").
5. Valores intermediários: ajuste até o ruído ficar abaixo do traço e a voz acima.

## Teste 3: comparar os modos
1. Com o teste de microfone ligado e "Ouvir o que está sendo enviado" marcado (fones!), alterne Nenhuma, Padrão do navegador e Alta.
2. Esperado: "Alta" é a que mais reduz teclado e ventilador; a troca reinicia o teste sozinha.
3. Durante uma chamada a troca de modo reabre a faixa do microfone sem sair da sala.

## Se algo falhar
- Mensagem "Não foi possível carregar o filtro de Alta qualidade": o app segue só com a porta de ruído. Abra o console (F12) e procure por "RNNoise indisponível".
- No app desktop o CSP precisa de `'wasm-unsafe-eval'` (já incluído em `src-tauri/tauri.conf.json`); só vale após gerar um instalador novo.
- Krisp (LiveKit): não usado. A documentação da LiveKit é contraditória sobre o plano gratuito e não foi possível testar com microfone real aqui; por isso o RNNoise é o padrão (local, sem custo, sem depender de plano).
