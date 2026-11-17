// Automatic updates on Tauri (tauri-plugin-updater): latest.json from the GitHub Releases, signed
// with the project's key. Downloads in the background; installs on its own while the game is closed
// (TauriShell.autoInstall; the installer reopens the app), on "Reiniciar e atualizar" or on a tray quit.
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { AppState } from "../shared/types";
import { tr } from "../shared/i18n";
import { errorText } from "./errors";

const kCheckEveryMs = 30 * 60 * 1000;

const kLogFile = "update.log";
const kLogLines = 200;
let logChain: Promise<void> = Promise.resolve();

/**
 * One line in userData/update.log: what the updater did and when. Installs that silently did not happen
 * (seen 2026-11: a few days in a row on the owner's PC) leave nothing else to go on.
 */
export function updateLog(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}`;
  logChain = logChain
    .then(async () => {
      const old = (await invoke<string | null>("read_user_file", { name: kLogFile })) ?? "";
      const lines = [...old.split("\n").filter(Boolean), line].slice(-kLogLines);
      await invoke("write_user_file", { name: kLogFile, text: lines.join("\n") + "\n" });
    })
    .catch(() => {});
}

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
    updateLog(`start v${this.state.current} packaged=${packaged} args=${JSON.stringify(location.search)}`);
    if (!packaged) return this.set({ status: "disabled", message: "modo desenvolvimento" });
    void this.check();
    this.timer = setInterval(() => void this.check(), kCheckEveryMs);
  }

  async check(): Promise<void> {
    if (this.state.status === "downloading" || this.state.status === "ready") return;
    this.set({ status: "checking", message: null });
    try {
      const u = await check();
      updateLog(`check: ${u ? `found ${u.version}` : "up to date"}`);
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
      updateLog(`downloaded ${u.version}`);
      this.set({ status: "ready", progress: 100 });
      this.notify(
        tr("Atualização pronta", "Update ready"),
        tr(
          `Exile Hub ${u.version} será instalado sozinho quando o jogo estiver fechado (ou clique em "Reiniciar e atualizar").`,
          `Exile Hub ${u.version} installs on its own while the game is closed (or click "Restart and update").`,
        ),
      );
    } catch (e) {
      updateLog(`check/download error: ${errorText(e)}`);
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
    updateLog(`install ${this.update.version}: running the installer`);
    await logChain; // the app exits as soon as the installer starts
    await this.update.install();
  }
}
