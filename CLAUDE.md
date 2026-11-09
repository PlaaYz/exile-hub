# Exile Hub — handoff notes

Goal: one desktop app for Path of Exile 1 that ties together what separate tools do today
(campaign route, PoB build, price check, farm EV, loot filter). The owner plays on the
primary monitor, so the **dashboard defaults to the secondary monitor**; the overlay is
optional and stays on the primary. The owner writes in Portuguese (pt-BR).

## Commands
- `npm install`, `npm start` (build + run Electron), `npm run typecheck`, `npm test`
- Build = `tsc -p tsconfig.main.json` (-> dist/main/main/main.js) + `vite build` (-> dist/renderer)

## Layout
- `src/core/` pure logic, no Electron: clientLog (Client.txt parser), tail (file tailer), route
  (exile-leveling DSL parser), tracker, timer, pob (PoB code import), ratelimit, session
  (area/character/route/timer state fed by Client.txt lines)
- `src/main/` Electron main + sandboxed preload (channel names duplicated on purpose, guarded by test/ipc.test.ts)
- `src/renderer/` React dashboard + overlay; `src/shared/` types + IPC contract
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
User-Agent has no contact email (GGG asks for one; add it if the app is distributed).

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

Support gem advice via Path of Building's engine (2026-11-08): uses the owner's installed PoB
(%APPDATA%\Path of Building Community; real version in manifest.xml — the registry DisplayVersion
lags). src/main/luaHost.ts loads PoB's lua51.dll (LuaJIT) with koffi, chdir to the PoB folder, runs
HeadlessWrapper.lua (MIT, vendor/pob; the version-matched copy is downloaded from the PoB GitHub tag
and cached in userData, bundled copy as fallback; io.read is stubbed so startup prompts never block)
and our driver vendor/pob/exilehub.lua (ehSuggest(json) -> json). It runs in an Electron
utilityProcess (src/main/pobWorker.ts, ~2 s boot, ~1-3 s per ranking). Character is approximated as
a campaign one: tree reset, items removed except weapons, gem levels from the character level.
Candidates = core/gemAvailability (exile-leveling quests.json: quest rewards + vendor by class up to
the current act, required level). exile-leveling support ids "SupportGemX" differ from PoB's
"SkillGemSupportX": the driver maps them (and falls back to gemForBaseName). Class for availability =
the class being played (core/classes baseClass of the log's class/ascendancy); UI warns if the build
is for another class. Only up to level 70. test/pobEngine.test.ts drives the real engine when PoB
is installed (skipped otherwise). Packaging: vendor/pob -> resources/pob, koffi asarUnpack.

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

UI language: pt-BR, strings written inline in the components (no i18n framework). Game names
(zones, quests, bosses, items, gems) stay in English to match the owner's English client. Route
instruction text is translated through `src/shared/routePtBR.ts`; `test/routePtBR.test.ts` fails if
the route data gains a piece without a translation. `shared/render.ts` (stepText) stays English for tests.

Tauri (shipped since 0.3.0, 2026-11-09; the Electron build in src/main still compiles and runs):
- src/app/ = the app without Node/Electron (hub.ts, logService, priceService, gemAdvice, treeService,
  config, ipcClean, diagnostics) behind `Platform`/`Shell` (src/app/platform.ts). Electron implements
  it in src/main/electronPlatform.ts + windows.ts; Tauri in src/tauri/ (tauriPlatform, tauriShell,
  tauriPob, boot.ts). On Tauri the app runs in the DASHBOARD webview (main.tsx imports
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
