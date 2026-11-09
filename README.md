# Exile Hub

Companion app for Path of Exile 1, in Portuguese (pt-BR). Everything is read from the game's
`Client.txt`, the clipboard and official/public APIs: no memory reading, no injected input.

- Campaign route that follows you on its own, per-character progress and act timers
- Path of Building: copy a build code/link and it is imported; passive tree progress vs the build
- Price check: Ctrl+C over an item in game (poe.ninja + official trade API)
- Maps: time per map, maps/hour, deaths, sessions
- Boss farm: expected value per run with live prices and your own measured run times
- In-game overlay (F9 show/hide, F10 clickable) and a dashboard on the second monitor
- Lives in the system tray; can start with Windows and open the dashboard when the game starts

## Install

Download `ExileHub-Setup-<version>.exe` from the
[Releases](https://github.com/PlaaYz/exile-hub/releases) page and run it (per-user install, no
admin needed). The installed app updates itself from the Releases page: new versions download in
the background and install when you quit (or with "Reiniciar e atualizar" in the footer).
Since 0.3.0 the app is built with Tauri (2.7 MB installer, uses the WebView2 already in Windows);
installs of 0.2.x (Electron) update to it on their own and keep settings and progress.

Closing the window keeps the app in the tray; right-click the tray icon > Sair to quit. Run the
game in windowed fullscreen so the overlay shows on top. Optional: Path of Building Community
installed enables the support gem suggestions.

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.

## Release

Bump `version` in package.json, then (with the updater signing key in TAURI_SIGNING_PRIVATE_KEY):

    npx tauri build                                  # signed NSIS installer
    node scripts/tauri-release.mjs "release notes"   # release/ExileHub-Setup-<v>.exe(.sig), latest.json, latest.yml
    gh release create v<v> release/ExileHub-Setup-<v>.exe release/ExileHub-Setup-<v>.exe.sig release/latest.json release/latest.yml

`latest.json` updates Tauri installs; `latest.yml` moves old Electron (0.2.x) installs to the new installer.

## Develop (Windows, Node 20+, Rust stable MSVC + VS Build Tools)

    npm install
    npx tauri dev        # Tauri app with the Vite dev server
    npm run typecheck
    npm test

Route data: exile-leveling (MIT), see `data/LICENSE-exile-leveling`.
