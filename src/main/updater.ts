// Automatic updates from the GitHub Releases of the public repository (electron-updater).
// Only the installed app (NSIS installer) can update itself; the portable .exe and development
// runs just report that updates are off.
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { AppState } from "../shared/types";

const kCheckEveryMs = 4 * 3600 * 1000;

export interface UpdaterContext {
  broadcast(): void;
  notify(title: string, content: string): void;
}

export class Updater {
  state: AppState["update"] = { status: "disabled", current: app.getVersion(), version: null, progress: null, message: null };
  private timer: NodeJS.Timeout | null = null;
  /** true once start() decided updates can run (installed, packaged app) */
  private enabled = false;

  constructor(private readonly ctx: UpdaterContext) {}

  private set(patch: Partial<AppState["update"]>): void {
    this.state = { ...this.state, ...patch };
    this.ctx.broadcast();
  }

  start(): void {
    if (!app.isPackaged) return this.set({ status: "disabled", message: "modo desenvolvimento" });
    if (process.env.PORTABLE_EXECUTABLE_FILE) {
      return this.set({ status: "disabled", message: "versão portátil: use o instalador para receber atualizações sozinho" });
    }
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // installs when the app quits (tray > Sair, Windows shutdown)
    autoUpdater.on("checking-for-update", () => this.set({ status: "checking", message: null }));
    autoUpdater.on("update-not-available", () => this.set({ status: "latest", message: null }));
    autoUpdater.on("update-available", (i) => this.set({ status: "downloading", version: i.version, progress: 0 }));
    autoUpdater.on("download-progress", (p) => this.set({ status: "downloading", progress: Math.round(p.percent) }));
    autoUpdater.on("update-downloaded", (i) => {
      this.set({ status: "ready", version: i.version, progress: 100 });
      this.ctx.notify("Atualização pronta", `Exile Hub ${i.version} será instalado quando você fechar o app (ou clique em "Reiniciar e atualizar").`);
    });
    autoUpdater.on("error", (e) => this.set({ status: "error", message: e?.message ?? String(e) }));
    this.enabled = true;
    this.check();
    this.timer = setInterval(() => this.check(), kCheckEveryMs);
  }

  check(): void {
    if (!this.enabled || this.state.status === "downloading" || this.state.status === "ready") return;
    autoUpdater.checkForUpdates().catch((e: Error) => this.set({ status: "error", message: e.message }));
  }

  /** Quit now and install the downloaded update (the app restarts by itself). */
  installNow(): void {
    if (this.state.status !== "ready") return;
    if (this.timer) clearInterval(this.timer);
    autoUpdater.quitAndInstall(true, true);
  }
}
