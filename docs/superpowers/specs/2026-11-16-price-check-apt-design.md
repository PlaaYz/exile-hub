# Price check no estilo do Awakened PoE Trade

## Por quê
O dono acha o price check "horrível". O fluxo dele no APT era: Ctrl+D, desmarcar alguns mods, ver o preço.
No nosso, a lista de mods fica no fim do popup, mexer nela exige clicar em "Buscar" e o preço novo
aparece lá em cima: dá para fazer, mas rolando para baixo e para cima a cada ajuste.

## Objetivo
- Ctrl+D abre o popup com o nome do item e, logo abaixo, os mods com caixinha e mínimo/máximo.
- Desmarcar/marcar um mod ou mudar um número refaz a busca sozinho e o preço aparece logo abaixo dos mods.
- Vale para o popup do Ctrl+D e para a aba Preço (o mesmo componente, `PricePanelBody`).

## Fora do escopo
- Estimativa automática de rare (não existe fonte: poeprices.info fechou).
- Atalhos extras do APT (Alt+W wiki, Shift+Space widgets), comportamento "some quando o mouse sai".
- PoE 2.

## Anti-objetivo
- Gastar o limite de buscas da GGG (600 a cada 6 h, 5 a cada 10 s) com cliques rápidos: um ajuste
  rápido em sequência tem que virar UMA busca.

## Abordagens consideradas
1. **Reorganizar o painel que já existe** (escolhida pelo dono, 2026-11-16): mesmo componente para popup
   e aba, menos código, as duas telas melhoram juntas.
2. Popup novo só para o Ctrl+D: duas telas de preço para manter, se desencontram.
3. Reaproveitar o código do APT: Vue e outra estrutura; adaptar custa mais que o 1.

## Desenho (decidido)
- Ordem no `PricePanelBody`: título do item -> linha curta (raridade, classe, ilvl, liga) -> **editor de
  busca** (filtros de venda/base/corrompido, faixas DPS/defesa/ilvl..., mods) -> **resumo + anúncios**
  (com whisper) -> "Abrir no site do trade" / "Mais resultados" -> o resto.
- Busca automática: qualquer mudança no editor agenda `priceResearch` 1 s depois da última mudança
  (debounce). Uma mudança nova antes disso reinicia a espera. O botão "Buscar" sai.
- Se uma busca ainda está rodando quando outra é pedida, vale a mais nova (o `seq` do PriceChecker
  já descarta respostas antigas: conferir).
- Itens sem busca no trade (`tradeStatus === "n/a"`, ex.: currency no bulk) continuam como hoje.

## Decisões minhas (o dono pode corrigir)
- Para rare/mágico, o bloco de tiers dos mods (`ModTiers`) e a linha de referência do poe.ninja ficam
  recolhidos num `<details>` abaixo dos anúncios; para único/gema/currency o preço do poe.ninja continua
  no topo, porque é o preço que importa nesses itens.
- "Itens recentes" continua no fim.
- Enquanto busca, o resumo mostra "buscando…" no lugar do preço anterior, sem pular a altura da tela.

## Para quem for construir
- Onde guardar o temporizador (componente, com limpeza ao trocar de item).
- Testar com o `price.test.ts` que uma sequência rápida de `research` vira uma busca só, se a lógica de
  espera ficar no núcleo; se ficar só na tela, conferir no app de teste.
