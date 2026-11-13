# Exile Hub — handoff notes

Goal: one desktop app for Path of Exile 1 that ties together what separate tools do today
(campaign route, PoB build, price check, farm EV, loot filter). The owner plays on the
primary monitor, so the **dashboard defaults to the secondary monitor**; the overlay is
optional and stays on the primary. The owner writes in Portuguese (pt-BR).

## Commands
- `npm install`, `npm run dev` (= `tauri dev`), `npm run typecheck`, `npm test`
- Build = `npx tauri build` (runs `vite build` -> dist/renderer, then cargo); see "Tauri" below for
  signing and releases. The Electron build (src/main, electron-builder) was removed on 2026-11-09.

## Layout
- `src/core/` pure logic (no platform): clientLog (Client.txt parser), route (exile-leveling DSL
  parser), tracker, timer, pob (PoB code import), ratelimit, session (area/character/route/timer state
  fed by Client.txt lines), item/trade/ninja/pricecheck (price check)...
- `src/app/` the app (Hub + services) behind the `Platform` interface; `src/tauri/` its Tauri
  implementation; `src-tauri/` the Rust side
- `src/renderer/` React dashboard + overlay; `src/shared/` types + the window.hub contract
- `data/` exile-leveling route/areas/gems data (MIT, see data/LICENSE-exile-leveling)

## State
Working: Client.txt tracking, route progress, act timers, PoB import, overlay (F9/F10), dashboard.
Verified on Windows (2026-11-08): app builds and runs, auto-detects the Steam Client.txt, and the
real log line formats match the parser. NOT verified: multi-monitor placement, the overlay over the
real game. Electron's postinstall was blocked by npm allowScripts on first install; approved now.

Price check (2026-11-08): main polls the clipboard (300 ms) and only acts on text starting with
"Item Class:" (the player's own Ctrl+C in game; no synthetic input). core/item parses it,
core/ninja prices currency/cards/fragments/uniques/gems via the NEW poe.ninja API
(`/poe1/api/economy/exchange/current/overview` for stackables, `/poe1/api/economy/stash/current/item/overview`
for uniques/gems; the old `/api/data/*` endpoints return 404), core/trade searches the official
trade API (search 5/10s and fetch 12/4s limits, separate RateLimiter each), core/stats maps mod
lines to trade stat ids (list cached in userData/trade-stats.json, 1 day). core/pricecheck ties it
together; tested with fakes in test/price.test.ts and live against Allflame with hand-written item
text. NOT verified: a real in-game Ctrl+C (exact text format, transfigured gems, Foulborn uniques).
User-Agent carries the project contact (see 0.3.9).

Farm EV tab (2026-11-08): `src/shared/farmData.ts` holds 13 pinnacle/uber boss tables (entry items +
drops per 100 kills). These are COMMUNITY ESTIMATES (GGG publishes no drop rates), taken from
farmofexile.com, which cites the PoE wiki tables. Each boss keeps its source URL, patch and sample
size; the owner chose "editable table + estimates". The wiki itself blocks automated fetches.
`core/farm.ts` computes EV; `ninja.priceByName` prices by name (exchange types, then invitations,
uniques, gems; several variants -> median, gems -> plain level 1). ~10 items (Reliquary Keys, a few
cards) have no poe.ninja price and almost no trade listings: they count as 0 until the user types a
price. User edits (rates, prices, minutes/run) live in renderer localStorage (`exile-hub.farmOverrides.v1`).

Automation batch 1 (2026-11-08):
- Route follows far jumps on its own (tracker rule 5); "off route" only for campaign zones the
  route never visits. Going back to the expected zone rewinds (rule 4).
- Characters: Client.txt names the character only on level-ups. A level-up from another character
  switches saved progress (route cursor + timer, paused while away). Entering 1_1_1 from anywhere but
  1_1_town while past the route start = new character: route and timers reset on their own.
- Progress per character in userData/progress.json (debounced 3 s + on quit); last PoB build in
  userData/build.json (restored at start).
- PoB codes / pobb.in / pastebin links copied to the clipboard are imported automatically
  (core/pob looksLikePob; failures are silent).
- Overlay hides while the game is unfocused or closed: "[WINDOW] Gained/Lost focus" and
  "Closing game gracefully" lines (setting overlayHideUnfocused). Not while F10-interactive.
  A game crash writes no closing line, so the overlay stays until focus lines resume.
- Git: repo on branch `main`, author set locally. If `git` is not on PATH in an agent session, use
  `C:\Program Files\Git\cmd\git.exe`. `.gitattributes` keeps LF.

Automation batch 2 (2026-11-08): core/bossRuns.ts detects pinnacle runs from arena area ids
(verified in the owner's log: AtlasExilesBoss5 Sirus, MavenBoss, MapWorldsPrimordialBoss3 Exarch,
MapWorldsPrimordialBoss4 Eater, MapWorldsShapersRealm, MapWorldsElderArena; Cortex/Venarius only by
the "You have entered" name, unverified). Area level >= 85 = uber. Same seed re-entered within
10 min = same run (deaths counted). main scans the whole Client.txt at start (~0.3 s for 27 MB,
async, live lines queued meanwhile) and keeps counting live; AppState.farmRuns feeds the Farm tab,
whose minutes/run default to the measured value (back-to-back cycle median, else fight + 1 min).
Note: PrimordialBoss1/2 are Infinite Hunger / Black Star, not in the farm tables.

Passive tree (2026-11-08): core/passives.ts. Tree data = GGG skilltree-export data.json (raw GitHub),
slimmed 6.6 MB -> ~0.5 MB, cached in userData/passive-tree.json for 7 days. Log lines "Successfully
(un)allocated passive skill id: X, name: Y" also carry Atlas ("atlas_*") and Genesis ("CurrencyNode*",
CamelCase) trees: only lower-case non-atlas ids count. Matching to PoB node ids is by NAME (notables
unique; small nodes by count). The log never names the character for passives: attributed to the
character leveling up in the same game session (pid in "Client <pid>"); >8 net points without a
level-up = another character, attribution stops until the next level-up. Still imperfect for
endgame characters (one of the owner's level 96 characters showed 165 points vs 127 possible) -> UI flags
"inconsistent" (pointBudget = level-1+24+8). Distances = BFS through the build's own nodes from
what is allocated (or the class start). If the log tail has no level-up, the last level-up of the
full scan picks the current character.

Map tracker (2026-11-08): core/maps.ts. Map = MapWorlds* instance (area id + seed), minus pinnacle
arenas and any *Boss* id. Portal trips to hideout/town = same run; non-map areas entered straight
from the map = sub-areas (time counts); areas entered from hideout (lab, campaign) do not. "Closing
game gracefully" and "***** LOG FILE OPENING *****" are focus events with `closing: true` and end the
in-map clock (boss runs too); any single in-map stretch is capped at 60 min. Sessions = gaps <= 30 min;
aggregate wall time is the sum of session spans. Tier = area level - 67. Fed by the same full-log
scan as boss runs/passives; AppState.maps -> "Mapas" tab + overlay line (current map, timer,
session/today counts). Owner's log: 676 maps since 2026-07-25, ~2.9 min avg, ~11.5 maps/h.

Tray / packaging (2026-11-08): closing the dashboard hides it (app stays in the tray; tray menu
"Sair" or Windows shutdown sets `quitting` and really quits). Second launch -> showDashboard().
`--hidden` (used by the login item) starts in the tray; the dashboard pops up (showInactive, no
focus steal) on the first "Gained focus" after a closing line = game started
(config.showDashboardOnGameStart). Start with Windows = app.setLoginItemSettings, path =
PORTABLE_EXECUTABLE_FILE when packaged (state read from the OS, never stored). Icon drawn in code
(src/shared/icon.ts): tray via nativeImage.createFromBitmap (BGRA), exe via `npm run icon` ->
build/icon.png. `npm run dist` -> release/ExileHub-<v>-portable.exe (~71 MB), verified to run.
Windows gotcha: electron-builder's winCodeSign 7z has macOS symlinks that need admin/Developer
Mode; fixed once by extracting it with 7za `-x!darwin` into
%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0.

Support gem advice (Path of Building's engine via LuaJIT, first koffi in an Electron utilityProcess,
then a Rust worker) was REMOVED in 0.3.7 at the owner's request (2026-11-09: "não faz sentido"):
luaHost/pobEngine/pobWorker, vendor/pob, src-tauri pob*.rs, koffi and libloading are gone (see git
history before 0.3.7 if it ever comes back). core/gemAvailability.ts stays only for its GemInfo type.

Map mechanics (2026-11-08): Client.txt NPC dialogue lines ("Niko, Master of the Depths: ...") ->
LogEvent "npc" (clientLog MECHANIC_NPCS, only known speakers, chat can't spoof), counted once per map
and only inside maps. Mechanics without dialogue (essences, strongboxes) are invisible to the log.
Mod tiers: Ctrl+Alt+C headers "{ Prefix Modifier "X" (Tier: N) — ... }" / crafted "(Rank: N)" ->
ItemMod.affix/tier/rank, roll from "(a-b)" ranges, item.affixes (rare 3+3, jewel 2+2, magic 1+1).
Buscas tab (core/searchRegex.ts): in-game search strings (50 chars). Map exclusions use the shortest
fragment (>=4 chars, word start) unique among ~60 known map lines (texts as in PoB's ModMap.lua);
poe.re's data was NOT used (no license). The app only copies text (navigator.clipboard).
Stash pricing via OAuth: GGG's developer docs say "We are currently unable to process new
applications" (checked 2026-11-08), so the official stash API is not reachable for a new app. The
POESESSID/legacy endpoints are forbidden (undocumented); screen reading was ruled out by the owner.
Public tools must show "This product isn't affiliated with or endorsed by Grinding Gear Games in any
way." (dashboard footer). OAuth apps' User-Agent: "OAuth {clientId}/{version} (contact: ...)".
Rebuilding the .exe fails/hangs while the owner's portable copy is running (it locks
release/ExileHub-<v>-portable.exe): ask them to quit it (tray > Sair) first.

Main process layout (2026-11-08 refactor): main.ts = Hub coordinator (settings, play session,
build, state); env.ts constants/paths/HTTP/icon; config.ts + ipcClean.ts (DEFAULT_CONFIG and a
table that must list every AppConfig key: renderer input is validated there); ipc.ts handlers;
diagnostics.ts; logService.ts (tail, full scan, live; bossRuns/passives/maps/sessions trackers);
priceService.ts; gemAdvice.ts; treeService.ts; windows.ts (dashboard, overlay, tray, login item);
updater.ts.
Sessões (core/gameSessions.ts): one session per game start (LOG FILE OPENING, now LogEvent focus
with `opening`) until "Closing game gracefully"; summary notification when the game closes.

Publishing (public repo https://github.com/PlaaYz/exile-hub, owner chose public on 2026-11-08):
- The public `main` started as ONE squashed commit (machine paths / character names scrubbed);
  the full earlier history is the local-only branch `local-history` (never push it).
- Release (since 0.3.0 = Tauri): bump package.json version, signed `npx tauri build`,
  `node scripts/tauri-release.mjs "notes"`, commit + `git push origin main`, then
  `gh release create v<v> release/ExileHub-Setup-<v>.exe release/ExileHub-Setup-<v>.exe.sig release/latest.json release/latest.yml`
  (gh is logged in as PlaaYz; no tokens are handled by hand; gh needs git on PATH:
  `$env:Path = "C:\Program Files\Git\cmd;$env:Path"`). No portable build any more.
- Electron releases (<= 0.2.2, `npm run dist`) installed to %LOCALAPPDATA%\Programs\exile-hub and
  updated via electron-updater from latest.yml; the latest.yml of Tauri releases points them to the
  Tauri installer.
- 0.2.0's updater never checked (initial "disabled" status blocked check()); fixed in 0.2.1, which the
  owner has installed. Updates from 0.2.1 on are automatic.

The owner decided the loot-filter manager is not needed (they use an online filter that auto-syncs).
Other ideas offered: build gem plan for leveling (where to get each gem), packaging/tray/autostart.

UI language (0.4.0): Portuguese or English, config.language "auto" (Windows language: pt-* -> pt, else en) / "pt" / "en".
Strings stay inline as tr("texto", "text") pairs (src/shared/i18n.ts, no keys, no framework); the module defaults to
"pt" (tests and pure code stay stable), the hub sets it from the config, every window from the state (useHubState).
Module-level label tables must be functions (they run once at import). Diagnostic lines (core/diag, diag.add) stay
pt-BR: the report goes to the owner. Route instructions: pt through routePtBR, English as in the data. Map mods in
English = the game's own mod line (searchRegex mapModLabel).
Donations: src/shared/links.ts DONATE_URL ("" = no link anywhere in the app; HubApi.openDonate opens only that fixed
https link) and docs/index.html const DONATE_URL ("" = the "Apoie" section stays hidden). Voluntary support only:
every feature stays free, nothing is unlocked by donating (GGG: their IP can't generate commercial revenue).
License: MIT (LICENSE, 2026-11-10, owner's choice; copyright "PlaaYz"). Windows SmartScreen ("Windows protected
your PC") shows on first installs because the installer is unsigned; site (#aviso-windows) and README explain "More
info > Run anyway". Signing options weighed 2026-11-10: SignPath Foundation (free, needs OSI license + CI build on
GitHub + approval; publisher "SignPath Foundation"), Certum Open Source (~EUR 49/yr, owner's real name), Azure
Trusted Signing (individuals only US/Canada).
CI (2026-11-10): .github/workflows/build.yml = typecheck + tests on every push/PR (windows-latest); "Run workflow"
builds the installer and uploads release/ as the artifact "exile-hub-installer". Secret TAURI_SIGNING_PRIVATE_KEY =
the key FILE's contents (set with gh secret set ... < file from Git Bash: PowerShell 5.1 piping added a UTF-8 BOM and
the build failed "Invalid symbol 239"). First CI installer verified: signed with the app's updater key (id e22d8ef4...).
Releases are still built on the owner's PC; next step = apply to SignPath (owner), then sign in CI.
0.4.1 (2026-11-11): between leagues the trade API lists only Standard & co. (seen 2026-11-11, before 3.30): while no
challenge league is listed, or after a failed read, PriceService.loadLeagues retries every 5 min (kLeagueWaitMs)
instead of hourly, so launch-day price checks switch to the new league within minutes (core/trade isChallengeLeague).
Register my equipment (0.4.1, owner's idea 2026-11-11): GearService (src/app/gearService.ts) + Price panel "Seu
equipamento". While on, items copied in game ("Item Class:" text) are stored by slot in userData/gear.json instead of
price checked (core/itemCompare gearSlotFor: 1st ring = Ring 1, 2nd = Ring 2, 2nd one-hander = Weapon 2; flasks/jewels
ignored); turns itself off after 3 min idle; overlay shows a line meanwhile. Compare = registered items first, PoB build
for the other slots (EquippedItem.fromGame / ItemComparison.fromGame tag), and DPS/defence rows (Q20) when both items
have them (game text does, PoB raw items do not). core/item parseItem skips reminder text in parentheses
(also over two lines) and a unique's flavour text (flavourSection: last plain-text section after the mods), and strips
single-bound rolls "41(50)%". The compare block shows only the totals (labels in pt via PriceView TOTAL_PT); other mod
differences are folded in a <details> ("Outros mods: N só neste · M que você perde"). Totals: "total resistance"
(ele + chaos, only present with chaos res) shows as chaos resistance alone; equal str/dex/int on both sides = one "all
attributes" row (itemCompare totalRows). Listing chaos values below 1 keep two significant digits (pricecheck withChaos). The GGG character API needs OAuth (closed); the legacy
character-window endpoint answered 403 with a bot challenge (2026-11-11): never work around it.
Session summary window (PARKED: constants kSessionSummaryPopup = false, nothing pops up at game close; owner 2026-11-11: no Windows toasts, "a small window like PoE Overlay"; NO ads, GGG
forbids commercial use of their IP): "summary" window (create:false, bottom right of the primary monitor, not
focused), shown by Hub.announceSessionEnd through Shell.showSessionSummary (notification only as fallback), hidden by
its close button (bridge call closeSessionSummary) or when the game starts again. SessionsView SessionSummaryApp shows
the last ended session, plus a support link only when DONATE_URL is set. Every window MUST carry the same
additionalBrowserArgs as the others (else WebView2 fails "0x8007139F ... not in the correct state"), and boot.ts must
list every secondary mode (else that window starts a second Hub: it failed on ACL "primary_monitor not allowed").
Price check split (2026-11-12, owner): Ctrl+C = equipment (register, else compare with what is worn: GearService.compare),
Ctrl+D = price (only the price key's copy is priced; with no price key configured, Ctrl+C still prices). Tab "Equipamento"
(GearView.tsx, Panel "gear"): ONLY items registered with Ctrl+C (owner 2026-11-12: it compares my gear with future swaps; no PoB
items, so PoB item sets per stage are parsed but unused), paper doll like the game's character screen, item art from poe.ninja (ninja iconFor:
unique's own art, else the BaseType overview's plain base; CSP img-src allows https://web.poecdn.com), no socket drawing (owner
2026-11-12: without the game's art it is useless; the detail line shows "sockets R-G-B (3L)"), click = mods; below, the last Ctrl+C item compared. Whisper button
on listings that are not instant buyout (owner chose this over the trade site's "Travel to Hideout", which needs the
POESESSID login: never): Hub.priceWhisper sends only a whisper of a listing on screen, after chat.rs bring_game_front
(finds the game window via EnumWindows when the click came from our own window). send_chat limit 200 -> 500 chars.
Build stages (2026-11-12, owner): PoB trees = stages (titles "Level 1-12", "Maps"...); a stage takes the skill set and item set
of the same title, else the same position, else the active one (core/pob setForStage). build.json keeps the picked "stage";
picker on the Build and Árvore tabs (HubApi.setBuildStage). The Árvore tab is a GUIDE of the imported build only (owner
2026-11-12): no character progress, no log comparison (TreeService.state(build) passes no allocations). Mod lines in pt: core/modPt ModTranslator = English stat list + GGG's Brazilian one
(br.pathofexile.com/api/trade/data/stats, userData/trade-stats-pt.json, daily) by stat id; buff/charge/ailment names stay
English (KEEP table there); unknown lines stay English. Used on the Equipamento tab.
0.4.2 (2026-11-11): who is playing survives restarts and logins. Session.onLogin keeps the last character as a guess
(`assumed`): undone by another character's level-up/death, the area-level check (kLevelSlack) or the logged-out-area
match; while assumed, its saved progress is never overwritten (saveCurrent). The owner's pick in the header is saved
as progress.json "current". backfill also updates `endgame` (updateEndgame), so a restart in the hideout still knows.
Native controls use the dark palette (color-scheme: dark in styles.css and the site). Site screenshots open in an
in-page lightbox (no new tab: the owner got stuck on the bare image).
Verified in game by the owner (2026-11-11, 0.4.x): overlay hides on alt-tab (overlayHideUnfocused on), Ctrl+D popup
(opens, drags, Esc, clipboard restored), F5 /hideout, equipment registration. Updater verified on a real update
(0.4.3 -> 0.4.7 via "Reiniciar e atualizar", exe and registry checked, 2026-11-12). Since 0.4.9 (owner 2026-11-12) checks every 30 min and
installs on its own 1 min after "ready" or after the game closes, never while the game runs (TauriShell.autoInstall;
the updater passes /R so the installer reopens the app). Force-killing the app for tests skips the install. Still untested: trade cards with a real whisper, autostart after a reboot. SignPath Foundation: owner applied 2026-11-11
(answers in Claude outputs/signpath-pedido.md); when approved, sign in CI with their GitHub action, then add the Tauri
updater .sig of the SIGNED exe. Donations (0.4.3): LivePix https://livepix.gg/exilehub (Pix, main button on #apoie, owner 2026-11-11) and the owner's USDT address on Solana (given 2026-11-11), shown ONLY on the site's #apoie section (copy
button with a select+execCommand fallback, red "only USDT on Solana" warning) and in the README; links.ts DONATE_URL =
SITE_URL#apoie (the app's footer button opens it); .github/FUNDING.yml custom link (GitHub "Sponsor" button).
Atlas tree planner (2026-11-12, RELEASED the same day: site nav "Árvore do Atlas", indexable): docs/atlas/ (index.html + atlas.js, our own
canvas viewer, written from scratch, drawn with GGG's official atlas sprite sheets at zoom 0.5 in docs/atlas/img:
world size = sprite px x 2; links stroked, not textured). Smoothness (2026-11-12): the unchanging layer is pre-drawn
once into a 3072 px picture of the whole tree (2048 on phones) used while zoomed out (cache.k x 1.25); zoomed in, only
what is on screen is drawn (background cropped, links culled); allocated/preview/hover nodes are drawn on top each
frame. 15-19 ms -> 0.3-1.6 ms per frame at 1920 px. Animated zoom, drag inertia, two-finger pinch. + data.json / ruthless.json built by `npx vite-node scripts/atlas-build.mts <tag>` from
GGG's official github.com/grindinggear/atlastree-export (tag 3.30.0) and data/atlas-ptbr.json (the owner's pt-BR table,
English text with numbers as "#"; GGG markup "[A|B]" -> "B"; keys matched with or without line breaks; the script lists
what is missing). The owner's earlier copy of hypostasis.faith/atlas (their viewer + hotlinked assets, no license) was
NOT used. Each league: rebuild with the new tag, translate what the script reports.
Atlas features (2026-11-12, ported in our own code from ideas of the owner's atlas-ptbr project): the build pairs EN/PT
texts per node id from GGG's official pages (www. and br.pathofexile.com/atlas-skill-tree, `passiveSkillTreeData`)
before falling back to data/atlas-ptbr.json; every node carries its mechanic (mastery cluster, else name rules; 24
global nodes have none). Page: mechanic highlight (panel list allocated/total, or a click on a mastery icon), saved
trees in localStorage ("exile-hub.atlas.builds", per browser), PT/EN toggle for node texts ("exile-hub.atlas.lang";
the page chrome stays pt-BR), search in both languages. Mechanic keywords stay in English inside the pt texts
(Threads, Shrine, Strongbox, Breach...; atlas-build.mts KEEP table, owner 2026-11-12): add new ones there.
Bump the "?v=" of atlas.js (index.html) and of the json fetch (atlas.js) on every atlas change: Pages caches 10 min and
a new page with a cached old script showed an empty saved-builds list.
Site screenshots: docs/img/{farm,maps,sessions}-{pt,en}.png, taken from the real dashboard through CDP with character
names replaced by their class (scratchpad shots.mjs); no price shot (other players' account names, owner's PoB test ring).
Website: docs/ on GitHub Pages (https://plaayz.github.io/exile-hub/), download button = latest release via the GitHub API.
Old note: pt-BR strings were written inline in the components (no i18n framework). Game names
(zones, quests, bosses, items, gems) stay in English to match the owner's English client. Route
instruction text is translated through `src/shared/routePtBR.ts`; `test/routePtBR.test.ts` fails if
the route data gains a piece without a translation. `shared/render.ts` (stepText) stays English for tests.

Tauri (the only build since 2026-11-09; Electron code removed, its history is in git before 0.3.8):
- src/app/ = the app (hub.ts, logService, priceService, treeService, challengeService, config,
  ipcClean, diagnostics) behind `Platform`/`Shell` (src/app/platform.ts), implemented in src/tauri/
  (tauriPlatform, tauriShell, tauriUpdater, boot.ts). On Tauri the app runs in the DASHBOARD webview (main.tsx imports
  src/tauri/boot when `__TAURI_INTERNALS__` exists); the overlay's window.hub forwards a whitelist of
  calls through events ("hub-call"/"hub-reply") and receives "state". Background throttling is off via
  additionalBrowserArgs (clipboard polling must keep running while the dashboard is hidden).
- src-tauri/ (Rust): files.rs (resources data/ + pob/, user files in the SAME %APPDATA%\exile-hub as
  Electron, atomic writes), logfile.rs (tail/scan/follow; only files named Client.txt), pob.rs +
  pob_worker.rs (PoB engine = this exe with --pob-worker, stdin/stdout JSON lines prefixed "EH:").
  Toolchain: rustup stable MSVC + VS 2022 Build Tools; cargo is in %USERPROFILE%\.cargo\bin (not on
  PATH in old shells). `npx tauri build --debug --no-bundle` -> src-tauri/target/debug/exile-hub.exe.
- Updates on Tauri: tauri-plugin-updater, latest.json on the GitHub release, signed with the key in
  %USERPROFILE%\.tauri\exile-hub.key (empty password; NEVER commit it; losing it = Tauri installs can
  no longer update). Build: env TAURI_SIGNING_PRIVATE_KEY=<that path>, TAURI_SIGNING_PRIVATE_KEY_PASSWORD="",
  `npx tauri build`, then `node scripts/tauri-release.mjs "notes"` -> release/ExileHub-Setup-<v>.exe(.sig),
  latest.json (Tauri) and latest.yml (makes Electron 0.2.x installs download the Tauri installer).
  src-tauri/windows/hooks.nsh: PREINSTALL silently uninstalls the Electron build
  (%LOCALAPPDATA%\Programs\exile-hub) and moves its autostart entry; POSTINSTALL relaunches on
  electron-updater's "--force-run". Tauri installs to %LOCALAPPDATA%\Exile Hub, exe "Exile Hub.exe".
- Never run the Electron app and the Tauri build at the same time: both write the same user files.
- Debug the webviews with env WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9334.
- Measured 2026-11-08, 60 s after start, PoB engine off: Tauri release 505 MB working set / 256 MB
  private (8 procs, exe 6.8 MB); Electron 0.2.1 minus its engine process ~506 MB WS / ~337 MB private
  (install 273 MB). Electron 0.2.1 also boots the PoB engine at start (+421 MB); the on-demand engine
  (src/app/gemAdvice.ts) removes that on BOTH builds.
- Verified on Tauri: log scan (676 maps / 13 boss runs), price check via plugin-http, PoB worker boot
  (1.8 s), overlay bridge. NOT yet: tray menu clicks, F9/F10, notifications, autostart, installer,
  signed updater, overlay over the real game.

0.3.1-0.3.4 (2026-11-09):
- Clipboard: Rust watches GetClipboardSequenceNumber (src-tauri/src/clipboard.rs) and only reads on change.
- Overlay window ("create": false in tauri.conf) is created by overlay_open when the game starts
  (Shell.gameRunningChanged) and destroyed 5 min after the game closes; its position is saved in
  config.overlayPos (internal key) when dragged and restored if still on a monitor.
- Dashboard: no React redraw while hidden in the tray (a never-shown --hidden window still reports
  document "visible": TauriShell tracks dashboardShown; Rust emits "dashboard-shown" on 2nd launch).
- Chat commands (owner approved, 2026-11-09: ONE chat line per key press, like Awakened PoE Trade):
  core/chatCommands.ts, config.chatCommands (default F5 /hideout); keys registered only while the log
  says the game is running+focused; src-tauri/src/chat.rs sends Enter, Ctrl+A, text, Enter with
  SendInput only if the foreground exe starts with "PathOfExile". {last_whisper} = last "@From" sender
  (LogEvent "whisper", the message text is never kept).
- Endgame mode: Session.endgame = a map or a non-campaign area of level >= 68 (hideouts/towns neutral);
  overlay shows maps only, campaign panel paused, gem advice idle.
- Passive tree map (panel only, owner did not want it on the overlay): slimTree keeps x/y (PoB orbit
  angle tables for 16/40 slots) and arcs; kTreeFormat=2 forces re-download of old caches;
  compareTree.nextPath = 15 points chained notable to notable; geometry via getTreeLayout().
- Challenges tab: GGG has no API for completed challenges -> ticked by hand, per patch, in
  userData/challenges-progress.json. The list is data/challenges.json on GitHub main (fetched, 6 h
  cache, bundled fallback): update it each league without an app release (3.30 list still empty).
- Vendor search: linkSearchCounts(n, r, g, b) (free sockets as \S to fit 50 chars) + chromatic recipe.
- Stash value: not possible (wealthyexile uses its own approved OAuth client; no public API).

0.3.7 (2026-11-09) who is playing: LogService replays the whole log at startup with the session's
rules (a level-up names the character, a login forgets it, "X has been slain" of one of the account's
characters names it) and keeps LogService.characters = every own character with its last class/level.
Session.known / identify / refreshFromKnown use it; the dashboard header has a picker
(state.knownCharacters, HubApi.setCharacter) for when the log cannot tell (an old character that
neither levels nor dies). Overlay map line: session count, average time and maps/hour; the endgame
head only shows outside maps.

Price check round 2 (0.3.8, 2026-11-09, goal: Awakened PoE Trade level):
- Price key (config.priceCheckKey, default Ctrl+D; owner-approved synthetic input: one key = one
  Ctrl+Alt+C): registered with the chat command keys only while the game has focus; src-tauri
  game.rs copy_item/focus_game/cursor_pos; PriceService.expectHotkeyItem opens the "price" window
  (create:false, mode=price, PricePopup.tsx) next to the mouse and restores the player's clipboard.
  The popup talks to the dashboard through the overlay bridge (OVERLAY_CALLS whitelist).
- core/itemCalc.ts: pseudo totals (ele/total res, life incl. str/2, attributes, ES off armour, MS),
  weapon pDPS/eDPS/DPS and AR/EV/ES at Q20 (local increases). core/trade.ts defaultFilters /
  coveredByCalc / buildQuery(item, mods, filters): rares by category, weapons by pDPS (attack mods
  only), armour by defences, totals replace the lines they sum, links only for non-rares.
- Bulk exchange: /api/trade/exchange (own RateLimiter), ids from /api/trade/data/static
  (userData/trade-static.json, 1 day); offers far below poe.ninja are flagged "suspeito".
- Listings carry seller/character/online-afk-offline; "Mais resultados" fetches the next 10 ids.
- poeprices.info is gone (2026-11-09: API redirects, /lander answers 403): no rare price prediction.
- Desktop shortcut: the owner wants it recreated on EVERY install/update (Tauri skips it in /UPDATE
  mode); src-tauri/windows/hooks.nsh POSTINSTALL deletes and recreates $DESKTOP\Exile Hub.lnk.

0.3.9 (2026-11-09):
- Buy request cards: core/tradeWhisper.ts parses ONLY the trade site's whisper templates (single item
  with/without stash position, unpriced, bulk "I'd like to buy your N X for my M Y"); other whispers
  stay unread. LogEvent whisper.offer + LogEvent "join" (": X has joined the area." -> card "chegou").
  Hub.trades (max 6, 15 min) -> "trades" window (create:false, transparent, focusable:false so its
  buttons type in the game's chat via sendChat without stealing focus), right side of the primary
  monitor, sized to the cards. Buttons: /invite, /tradewith, "@x ty, gl!", "@x sorry, it's already
  sold", /kick, close. Setting tradeAlerts. Never tested with a real whisper (none in the owner's log).
- poe.ninja 7-day trend (sparkline / sparkLine) on the price check (core/ninja trendOf).
- League list re-read every hour (new league on launch day without restart); a hand-picked league
  that no longer exists falls back to automatic.
- Diagnóstico tab hidden unless config.showDiagTab. Karui Shores (zone data act 11) = endgame.
- User-Agent: "ExileHub/<v> (contact: exilehub.contato@gmail.com)" (project address the owner created
  for this, 2026-11-09; src/tauri/tauriPlatform.ts kContact).

0.3.10 (2026-11-09): the price popup closes on the WINDOW losing activation (Tauri onFocusChanged,
150 ms grace), not the page's "blur": dragging the title bar (Windows move loop) blurred the webview
and closed it on every drag.

0.3.11 (2026-11-09):
- Trade search "venda" list = the trade site's status options (available / securable / onlineleague /
  online / any, all checked live); every search starts at "securable" (instant buyout), bulk exchange
  uses the same. Listings with method "psapi" = instant buyout (no online status) -> SellerStatus "instant".
- core/itemCompare.ts: the PoB export's active ItemSet (parsePobEquipped; {range:x} rolls filled in,
  {variant} by "Selected Variant", needs the "Implicits: N" line) -> PriceView.compare = pseudo totals
  and mod lines vs the same slot (rings: Ring 1-3). No DPS/defences (PoB raw items have none).
  Hub.equipped is re-read from build.json's code at start.
- Fewer than 3 trade results -> PriceChecker.runSimilar: same search with mins 20% lower (PriceView.similar).
- PriceService.recentChecks (10, with item text) -> state.priceRecent; HubApi.priceRecheck(id).
- Welcome screen (config.welcomeDone), "Reportar problema" (copyDiagReport + GitHub new issue, the
  player pastes; nothing is sent by the app). Numeric table headers right-aligned (th.num-cell).

0.3.13 (2026-11-09): the overlay never shows while the game is closed (with overlayHideUnfocused off it
opened at app start); applyOverlayVisibility requires gameRunning.

Farm tab like bossofexile.com (2026-11-09, owner's request; their numbers were NOT copied):
- 29 bosses (16 new from farmofexile article tables, same source as before): Elder, Uber Atziri,
  Venarius, Catarina, the 3 Incarnations + ubers, Black Star, Infinite Hunger, King in the Mists,
  Oshabi, Esh-Tul, Zorath. No T17 maps (no source with rates).
- FARM_POOLS = items that exclude each other (unique pool, astrolabe); core/farm profitChance =
  Monte Carlo of 10 runs (seeded, 2000 trials in the tab) -> riskOf groups safe/low/medium/high/
  negative (95/80/60%). Time per run = typed > measured in Client.txt, nothing else (owner, 2026-11-09:
  no default times); bosses without a run have no profit/hour and sort after the timed ones.
- T17 nightmare maps (Citadel, Sanctuary, Ziggurat, Fortress, Abomination): rates from bossofexile.com
  (owner asked, 2026-11-09), entry "Nightmare Map (T17)" fixed 50c (FarmItem.price, not looked up);
  FarmBoss.mapName -> time per run = the map tracker's average for maps of that name.
- Arenas verified in the owner's log by "You have entered": BetrayalMastermindFight (Mastermind's
  Lair, Catarina), MapWorldsMemoryBoss1/2/3 (Moment of Trauma/Loneliness/Reverence = Fear/Neglect/
  Dread), MapWorldsPrimordialBoss1 (Seething Chyme, Infinite Hunger), 2 (Polaric Void, Black Star).
- core/farmTrade: items poe.ninja lacks, or prices >= 50 div with < 20 listings (joke listings:
  Voidforge showed 880k chaos), are priced on the trade site: one search per item (unique name+base
  or type from /api/trade/data/items, userData/trade-items.json daily), instant buyout then online,
  median of the 10 cheapest. Background, 20 s apart (search limit ~30 per 5 min), paused 30 s after
  any player price check; userData/farm-trade-prices.json, 1 h per item; state.farmPricesVersion
  makes the tab refetch.

Session earnings (2026-11-09): GameSession.kills = fresh boss arenas (normal/uber by level) and T17
maps (bossRuns farmIdOf: MapWorldsCitadel/Sanctuary/Ziggurat/Fortress/Abomination, seen in the owner's
log) by farm id; core/farm sessionEarnings = farmEv profit x count with market prices (the player's
Farm-tab edits live in localStorage and are NOT applied). Hub keeps PriceService.lastFarmPrices fresh
(retry each minute until the league loads, refresh hourly); Sessões tab column "Rendimento" + the
close notification. Normal maps are not valued (the log has no drops).

## Known issues / notes
- `src/main/main.ts`, `preload.ts`, `shared/types.ts`, `renderer/index.html` were rebuilt from
  compiled output after an accidental overwrite; behaviour matches, but diff against any older copy.
- `Hub` in main.ts delegates log/route/timer state to `core/session.ts` (tested in test/session.test.ts).
- Client.txt line formats come from community docs: check them against a real log first.

## Constraints
Read-only on the game: Client.txt, clipboard, official APIs only. No memory reading, injection or
synthetic input. Respect GGG rate limits.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
- Windows note: graphify installed with pip from inside the Claude desktop app lands in the app's
  virtualized AppData folder, which is not on PATH; shims named `graphify.cmd` / `graphify` in a
  folder on PATH forward to it. If the hooks fail with "graphify not recognized" (blocking Read),
  check those shims (machine-specific paths are kept outside the repo).
  Graph built with `graphify extract . --code-only` + `graphify cluster-only . --no-label` (no LLM);
  `.graphifyignore` skips node_modules, dist and data/json. graphify git hooks (post-commit,
  post-checkout, post-merge, post-rewrite) rebuild the graph in the background; graphify-out/ is
  NOT tracked (it is regenerated). A bash shim `graphify` (next to graphify.cmd, same folder) makes
  the hooks work when they run under Git Bash.
