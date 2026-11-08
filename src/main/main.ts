// Exile Hub on Electron: creates the platform (files, clipboard, PoB engine, windows) and runs the
// app from src/app on it. The app logic itself lives in src/app (shared with the Tauri build).
//   env.ts             paths, window sizes, HTTP, icon    windows.ts  dashboard, overlay, tray
//   electronPlatform.ts the Platform for src/app           ipc.ts      IPC handlers
//   pobEngine.ts / pobWorker.ts / luaHost.ts  PoB engine   updater.ts  electron-updater
import { app, globalShortcut, session as electronSession } from "electron";
import { kOverlayInteractKey, kOverlayToggleKey, kStateBroadcastMs } from "../app/constants";
import { Hub } from "../app/hub";
import { ElectronPlatform } from "./electronPlatform";
import { isDev } from "./env";
import { registerIpc } from "./ipc";
import { Updater } from "./updater";
import { Windows } from "./windows";

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const windows = new Windows();
  // a second launch (desktop shortcut, autostart) just brings the running app forward
  app.on("second-instance", () => windows.showDashboard());
  app.on("before-quit", () => {
    windows.quitting = true; // Windows shutdown / sign-out: really quit
  });
  void app.whenReady().then(async () => {
    if (!isDev) {
      electronSession.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        cb({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [
              "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'",
            ],
          },
        });
      });
    }

    let hub: Hub | null = null;
    const updater = new Updater({
      broadcast: () => {
        if (!hub) return;
        hub.updateState = updater.state;
        hub.broadcast();
      },
      notify: (t, m) => windows.notify(t, m),
    });
    const platform = new ElectronPlatform(windows, updater);
    const h = await Hub.create(platform);
    hub = h;
    h.updateState = updater.state;
    windows.ctx = {
      config: () => h.config,
      setConfig: (p) => h.setConfig(p),
      toggleOverlay: () => h.toggleOverlay(),
      setStartWithWindows: (on) => void h.setStartWithWindows(on),
    };
    registerIpc(h);
    // started by Windows at login: stay in the tray until the game opens
    windows.createDashboard(process.argv.includes("--hidden"));
    windows.createOverlay();
    windows.createTray();
    await h.start();
    updater.start();

    globalShortcut.register(kOverlayToggleKey, () => h.toggleOverlay());
    globalShortcut.register(kOverlayInteractKey, () => h.toggleOverlayInteractive());
    setInterval(() => h.broadcast(), kStateBroadcastMs);
    let saved = false;
    app.on("will-quit", (e) => {
      globalShortcut.unregisterAll();
      if (saved) return;
      // progress is written asynchronously: wait for it, then really exit
      e.preventDefault();
      void h.shutdown().finally(() => {
        saved = true;
        app.quit(); // again, now passing through (electron-updater installs on the "quit" that follows)
      });
    });
  });
}

// windows only close on "Sair" (they hide otherwise), so this is the real end
app.on("window-all-closed", () => app.quit());
