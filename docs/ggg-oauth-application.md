# Pedido de acesso à API da GGG (OAuth) — pronto para enviar

**Situação (09/11/2026):** a GGG não está aceitando pedidos novos ("We are currently unable to process
new applications", em https://www.pathofexile.com/developer/docs). Uma verificação semanal avisa
quando reabrir. Quando reabrir, siga os passos abaixo.

## Passo a passo (você faz, logado na sua conta do Path of Exile)

1. Entre em https://www.pathofexile.com com a conta que vai ser dona do app.
2. Abra o seu perfil e procure **"Manage applications"** (Gerenciar aplicativos). O link também aparece
   em https://www.pathofexile.com/developer/docs, na seção "Registering your Application".
3. Crie um aplicativo novo e preencha com os textos da seção abaixo (copie e cole; estão em inglês
   porque é assim que a GGG lê).
4. Tipo de cliente: **Public client** (é um programa instalado; a GGG exige isso para apps baixáveis).
5. Envie e aguarde a resposta da GGG por e-mail (vai para o e-mail da conta; o contato do projeto é
   exilehub.contato@gmail.com).
6. Quando aprovarem, você recebe um **client id**. Me mande esse id (ele não é segredo num public
   client) e eu ligo o "Entrar com a GGG" no app.

## Textos para colar

**Application name**
```
Exile Hub
```

**Description**
```
Exile Hub is a free, open-source desktop companion for Path of Exile 1 (Windows). It follows the
player's own Client.txt to guide the campaign, track maps and sessions, and price items through the
official trade site and poe.ninja. With OAuth we would like to show the player the value of their
own stash tabs and identify which of their characters is being played (name, class, level, league),
which today the app can only guess from the log. Data is read only for the signed-in player, kept on
their own computer, never shared or sold. The app is free, has no ads and no paid features, shows
"This product isn't affiliated with or endorsed by Grinding Gear Games in any way." and respects the
documented rate limits.
```

**Website / repository**
```
https://github.com/PlaaYz/exile-hub
```

**Contact**
```
exilehub.contato@gmail.com
```

**Client type**
```
Public client (installed desktop application, Authorization Code with PKCE)
```

**Redirect URI**
```
http://127.0.0.1:41297/callback
```
(A porta 41297 foi escolhida para o app; a GGG pede um endereço local para public clients.)

**Scopes requested (and why)**
```
account:profile     - show who is signed in
account:characters  - list the player's characters (name, class, level, league) to know which one is played
account:stashes     - value the player's own stash tabs with poe.ninja / trade prices
account:leagues     - pick the player's current league for prices
```

**How the data is used / stored**
```
Tokens and data stay on the player's computer (%APPDATA%\exile-hub). Nothing is sent anywhere
except the official API itself and public price sources (poe.ninja, the official trade site).
The player can sign out at any time, which deletes the stored tokens.
```

## O que muda no app depois da aprovação (para mim)

- User-Agent passa para o formato exigido: `OAuth {clientId}/{versão} (contact: exilehub.contato@gmail.com)`.
- Login: abre o navegador na página de autorização da GGG (PKCE), recebe o código em
  `http://127.0.0.1:41297/callback`, troca por token. Token de acesso dura 10 h; o de renovação, 7 dias
  (depois disso, um clique para entrar de novo).
- Novos recursos: valor das abas do baú; personagem atual com nível e liga direto da conta (acaba o
  "personagem não identificado").
- Limites: public clients não recebem os escopos `service:*` (ladder, desafios por ladder, public
  stash). Challenges completos continuam sendo marcados à mão.
