// Automatic updates on Tauri (tauri-plugin-updater): latest.json from the GitHub Releases, signed
// with the project's key. Downloads in the background; installs on "Reiniciar e atualizar" or when the
// user quits from the tray (like electron-updater's autoInstallOnAppQuit).
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { AppState } from "../shared/types";
import { errorText } from "./tauriPob";

const kCheckEveryMs = 4 * 3600 * 1000;

export class TauriUpdater {
  state: AppState["update"];
  private update: Update | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    version: string,
    private readonly onChange: (s: AppState["update"]) => void,
    private readonly notify: (title: string, body: string) => void,
  ) {
    this.state = { status: "disabled", current: version, version: null, progress: null, message: null };
  }

  private set(patch: Partial<AppState["update"]>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  start(packaged: boolean): void {
    if (!packaged) return this.set({ status: "disabled", message: "modo desenvolvimento" });
    void this.check();
    this.timer = setInterval(() => void this.check(), kCheckEveryMs);
  }

  async check(): Promise<void> {
    if (this.state.status === "downloading" || this.state.status === "ready") return;
    this.set({ status: "checking", message: null });
    try {
      const u = await check();
      if (!u) return this.set({ status: "latest" });
      this.set({ status: "downloading", version: u.version, progress: 0 });
      let total = 0;
      let got = 0;
      await u.download((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          got += e.data.chunkLength;
          if (total) this.set({ progress: Math.round((got / total) * 100) });
        }
      });
      this.update = u;
      this.set({ status: "ready", progress: 100 });
      this.notify("Atualização pronta", `Exile Hub ${u.version} será instalado quando você fechar o app (ou clique em "Reiniciar e atualizar").`);
    } catch (e) {
      this.set({ status: "error", message: errorText(e) });
    }
  }

  get ready(): boolean {
    return this.state.status === "ready" && this.update !== null;
  }

  /** Runs the downloaded installer (the app closes and the installer restarts it). */
  async install(): Promise<void> {
    if (!this.update) return;
    if (this.timer) clearInterval(this.timer);
    await this.update.install();
  }
}
