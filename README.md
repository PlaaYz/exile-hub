# Exile Hub

**[Site](https://plaayz.github.io/exile-hub/) · [Português](#português) · [English](#english)**

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.

---

## Português

Aplicativo gratuito de apoio para Path of Exile 1, com interface em português. Ele junta num só
lugar o que hoje fica espalhado em várias ferramentas: rota da campanha, build do Path of Building,
price check, mapas, farm de bosses e sessões de jogo.

O app só **lê** dados: o `Client.txt` do jogo, a área de transferência e as APIs oficiais e
públicas (trade do site oficial, poe.ninja). Não lê a memória do jogo nem injeta nada. A única
entrada sintética são atalhos que você mesmo aperta: uma tecla equivale a uma ação.

### Painel e overlay
- O painel abre no **segundo monitor**, para você jogar no principal.
- Um overlay opcional fica por cima do jogo. **F9** mostra ou esconde, **F10** deixa clicável.
- O overlay some quando o jogo perde o foco ou fecha, e lembra a posição onde você o arrastou.
- O app fica na bandeja do sistema. Ele pode iniciar com o Windows e abrir o painel sozinho quando
  o jogo começa (sem roubar o foco).
- Uma tela de boas-vindas encontra o `Client.txt` (Steam ou standalone) e explica os atalhos.

### Campanha
- A rota da campanha (dados do exile-leveling) acompanha você sozinha, zona por zona. Ela segue
  saltos longos e volta quando você retorna à zona esperada.
- Cada personagem tem seu progresso salvo. Ao trocar de personagem, a rota e os tempos trocam
  junto, e um personagem novo começa a rota do zero automaticamente.
- Os tempos por ato aparecem na aba **Tempos**, que some quando o personagem chega ao endgame.
- No cabeçalho você escolhe o personagem quando o log não consegue identificá-lo.

### Build (Path of Building)
- Copie um código do PoB ou um link do pobb.in ou pastebin e a build é importada sozinha.
- A árvore passiva compara o que você já alocou com a build: pontos que faltam, caminho até os
  próximos notáveis e um mapa da árvore no painel.

### Price check
- Com o mouse sobre um item no jogo, aperte **Ctrl+D** (ou dê Ctrl+C). Uma janela abre ao lado do
  mouse com o preço.
- Moedas, cartas, fragmentos, únicos e gemas são precificados pelo poe.ninja, com a tendência dos
  últimos 7 dias.
- Itens raros são buscados no trade oficial. O app soma totais (resistências, vida, atributos),
  calcula DPS de armas e defesas em qualidade 20 e mostra o tier de cada mod.
- Você escolhe o tipo de venda (compra instantânea, online etc.). A busca começa sempre em compra
  instantânea.
- Compara o item com o que você usa no mesmo slot na build importada.
- Com poucos resultados, o app procura itens parecidos com mínimos 20% menores.
- Moedas em quantidade usam a troca em massa do trade e marcam como "suspeito" as ofertas muito
  abaixo do poe.ninja.
- As últimas 10 buscas ficam guardadas para refazer com um clique.
- Respeita os limites de requisição da GGG.

### Trocas
- Quando alguém sussurra para comprar um item seu (modelo do site de trade), aparece um cartão no
  canto da tela com o item e o preço.
- Os botões do cartão fazem convite, troca, agradecimento, "já vendido" e kick, sem tirar o foco
  do jogo.

### Mapas
- Tempo de cada mapa, tier, mortes, mapas por hora e média por sessão, a partir do log.
- Viagens por portal e subáreas contam no mesmo mapa.
- O overlay mostra o mapa atual, o cronômetro e as contagens da sessão.
- As mecânicas que têm falas de NPC (Niko, Alva, Einhar etc.) são contadas por mapa.

### Farm de bosses
- 29 bosses pinnacle e uber e 5 mapas T17, com valor esperado por run usando preços ao vivo.
- Mostra a chance de lucrar em 10 runs e classifica o risco: seguro, baixo, médio, alto ou
  negativo.
- Ordena por lucro por hora ou por kill.
- O tempo por run vem das suas próprias lutas, medidas no `Client.txt`, ou de um valor que você
  digita. Não há tempos padrão inventados.
- Itens que o poe.ninja não tem, ou que ele precifica de forma absurda, são buscados no trade em
  segundo plano.
- Taxas de drop, preços e minutos são editáveis. As taxas são estimativas da comunidade, e cada
  boss mostra a fonte.

### Sessões
- Uma sessão vai de quando o jogo abre até quando ele fecha.
- Cada sessão mostra tempo, mapas, bosses e o **rendimento esperado** dos bosses e mapas T17 que
  você fez. Mapas comuns não entram, porque o log não mostra drops.
- Ao fechar o jogo, uma notificação traz o resumo da sessão.

### Buscas
- Gera textos de busca para usar dentro do jogo (até 50 caracteres): exclusão de mods de mapa e
  busca de soquetes e links no vendedor, incluindo a receita cromática.

### Challenges
- Lista de challenges da liga para marcar à mão. A GGG não tem API para os challenges concluídos.
- A lista é atualizada a cada liga pelo GitHub, sem precisar de nova versão do app.

### Comandos de chat
- Teclas que digitam um comando no chat, por exemplo **F5** = `/hideout`. Funcionam só com o jogo
  em foco.

### Instalação
Baixe `ExileHub-Setup-<versão>.exe` na página de
[Releases](https://github.com/PlaaYz/exile-hub/releases) e execute. A instalação é por usuário e
não precisa de administrador.

O app se atualiza sozinho: a versão nova baixa em segundo plano e instala quando você sai do app,
ou na hora com "Reiniciar e atualizar" no rodapé.

Fechar a janela deixa o app na bandeja. Para sair, clique com o botão direito no ícone da bandeja e
escolha **Sair**. Jogue em tela cheia em janela para o overlay aparecer por cima.

Encontrou um problema? Use **Reportar problema** no app. Ele copia um relatório para você colar
numa issue do GitHub, e o app não envia nada sozinho.

---

## English

Free companion app for Path of Exile 1, with a Portuguese (pt-BR) interface. It brings together what
separate tools do today: campaign route, Path of Building build, price check, maps, boss farming and
play sessions.

The app only **reads**: the game's `Client.txt`, the clipboard and official/public APIs (the
official trade site, poe.ninja). No memory reading and no injection. The only synthetic input is
hotkeys you press yourself, one key = one action.

### Dashboard and overlay
- The dashboard opens on the **second monitor**, so you play on the primary one.
- An optional overlay sits on top of the game. **F9** shows or hides it, **F10** makes it clickable.
- The overlay hides when the game loses focus or closes, and remembers where you dragged it.
- The app lives in the system tray. It can start with Windows and open the dashboard when the game
  starts (without stealing focus).
- A welcome screen finds `Client.txt` (Steam or standalone) and explains the hotkeys.

### Campaign
- The campaign route (exile-leveling data) follows you on its own, zone by zone. It follows long
  jumps and rewinds when you go back to the expected zone.
- Progress is saved per character. Switching characters switches the route and timers, and a new
  character restarts the route automatically.
- Act timers are in the **Tempos** tab, which hides once the character reaches endgame.
- A header picker chooses the character when the log cannot tell.

### Build (Path of Building)
- Copy a PoB code or a pobb.in or pastebin link and the build is imported on its own.
- The passive tree compares what you have allocated with the build: missing points, the path to the
  next notables and a tree map in the dashboard.

### Price check
- Hover an item in game and press **Ctrl+D** (or Ctrl+C). A window opens next to the mouse with the
  price.
- Currency, cards, fragments, uniques and gems are priced from poe.ninja, with a 7-day trend.
- Rares are searched on the official trade site. The app builds pseudo totals (resistances, life,
  attributes), computes weapon DPS and defences at quality 20 and shows each mod's tier.
- You pick the sale type (instant buyout, online...). Every search starts at instant buyout.
- It compares the item with what you wear in the same slot in the imported build.
- With few results, it searches similar items with minimums 20% lower.
- Bulk currency uses the trade bulk exchange and flags offers far below poe.ninja as "suspeito".
- The last 10 checks are kept for a one-click recheck.
- GGG rate limits are respected.

### Trades
- When someone whispers to buy one of your items (trade site template), a card shows the item and
  price in the corner of the screen.
- Its buttons invite, trade, thank, say "already sold" and kick, without taking focus from the game.

### Maps
- Time per map, tier, deaths, maps per hour and averages per session, from the log.
- Portal trips and sub-areas count as the same map.
- The overlay shows the current map, its timer and the session counts.
- Mechanics with NPC dialogue (Niko, Alva, Einhar...) are counted per map.

### Boss farm
- 29 pinnacle and uber bosses and 5 T17 maps, with expected value per run at live prices.
- Shows the chance to profit over 10 runs and a risk group: safe, low, medium, high or negative.
- Ranks by profit per hour or per kill.
- Time per run comes from your own fights, measured in `Client.txt`, or a value you type. There are
  no made-up default times.
- Items poe.ninja lacks or prices absurdly are looked up on the trade site in the background.
- Drop rates, prices and minutes are editable. Rates are community estimates, and each boss shows
  its source.

### Sessions
- A session runs from game start to game close.
- Each session shows time, maps, bosses and the **expected earnings** of the bosses and T17 maps
  you ran. Normal maps are not valued, because the log has no drops.
- When the game closes, a notification summarizes the session.

### Searches
- Builds in-game search strings (up to 50 characters): map mod exclusions and vendor socket/link
  searches, including the chromatic recipe.

### Challenges
- League challenge list to tick by hand. GGG has no API for completed challenges.
- The list is updated each league from GitHub, with no app release needed.

### Chat commands
- Keys that type a chat command, e.g. **F5** = `/hideout`. They only work while the game has focus.

### Install
Download `ExileHub-Setup-<version>.exe` from the
[Releases](https://github.com/PlaaYz/exile-hub/releases) page and run it. It is a per-user install
and needs no admin rights.

The app updates itself: new versions download in the background and install when you quit, or right
away with "Reiniciar e atualizar" in the footer.

Closing the window keeps the app in the tray. To quit, right-click the tray icon and choose
**Sair**. Run the game in windowed fullscreen so the overlay shows on top.

Found a problem? Use **Reportar problema** in the app. It copies a report for you to paste into a
GitHub issue, and the app sends nothing on its own.

---

## Develop (Windows, Node 20+, Rust stable MSVC + VS Build Tools)

    npm install
    npx tauri dev        # Tauri app with the Vite dev server
    npm run typecheck
    npm test

## Release

Bump `version` in package.json, then (with the updater signing key in TAURI_SIGNING_PRIVATE_KEY):

    npx tauri build                                  # signed NSIS installer
    node scripts/tauri-release.mjs "release notes"   # release/ExileHub-Setup-<v>.exe(.sig), latest.json, latest.yml
    gh release create v<v> release/ExileHub-Setup-<v>.exe release/ExileHub-Setup-<v>.exe.sig release/latest.json release/latest.yml

`latest.json` updates Tauri installs; `latest.yml` moves old Electron (0.2.x) installs to the new installer.

Route data: exile-leveling (MIT), see `data/LICENSE-exile-leveling`.
