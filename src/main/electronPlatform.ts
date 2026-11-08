// The Platform the app (src/app) runs on inside Electron: Node files, Electron clipboard/dialogs,
// the PoB engine in a utilityProcess and the windows in windows.ts.
import { app, clipboard, dialog, shell, type OpenDialogOptions } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { LogFollower, Platform, Shell } from "../app/platform";
import { candidateLogPaths } from "../core/clientLog";
import { LogTailer } from "../core/tail";
import { dataDir, httpFetch, kUserAgent, pobVendorDir, pobWorkerPath, userFile } from "./env";
import { PobEngine } from "./pobEngine";
import type { Updater } from "./updater";
import type { Windows } from "./windows";

const kScanBatch = 2000;

export class ElectronPlatform implements Platform {
  readonly appVersion = app.getVersion();
  readonly packaged = app.isPackaged;
  readonly userAgent = kUserAgent;
  readonly fetch = httpFetch;
  readonly pob = new PobEngine(pobVendorDir, pobWorkerPath, kUserAgent);
  readonly shell: Shell;

  constructor(
    private readonly windows: Windows,
    private readonly updater: Updater,
  ) {
    const w = windows;
    const self = this;
    this.shell = {
      send: (s) => w.send(s),
      get windowsReady() {
        return w.windowsReady;
      },
      setOverlayVisible: (v) => w.setOverlayVisible(v),
      get overlayVisible() {
        return w.overlayVisible;
      },
      setOverlayInteractive: (on) => w.setOverlayInteractive(on),
      showDashboard: (steal) => w.showDashboard(steal),
      listDisplays: () => w.listDisplays(),
      moveDashboard: (id, fs) => w.moveDashboard(id, fs),
      updateTray: (t) => w.updateTray(t),
      notify: (title, body) => w.notify(title, body),
      startWithWindows: () => w.startWithWindows(),
      setStartWithWindows: (on) => w.setStartWithWindows(on),
      installUpdate: () => {
        w.quitting = true;
        self.updater.installNow();
      },
      quit: () => w.quit(),
    };
  }

  async fetchText(url: string, timeoutMs: number): Promise<string> {
    const res = await fetch(url, { headers: { "User-Agent": this.userAgent }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`falha no download (HTTP ${res.status})`);
    return res.text();
  }

  readData(rel: string): Promise<string> {
    return fsp.readFile(path.join(dataDir, rel), "utf8");
  }

  async readUserFile(name: string): Promise<string | null> {
    try {
      return await fsp.readFile(userFile(name), "utf8");
    } catch {
      return null;
    }
  }

  async writeUserFile(name: string, text: string): Promise<void> {
    const file = userFile(name);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, text);
  }

  async userFileAge(name: string): Promise<number | null> {
    try {
      return (await fsp.stat(userFile(name))).mtimeMs;
    } catch {
      return null;
    }
  }

  async detectLog(): Promise<string | null> {
    for (const p of candidateLogPaths()) {
      try {
        if ((await fsp.stat(p)).isFile()) return p;
      } catch {
        /* next */
      }
    }
    return null;
  }

  async pickLogFile(): Promise<string | null> {
    const opts: OpenDialogOptions = {
      title: "Selecione o logs/Client.txt do Path of Exile",
      properties: ["openFile"],
      filters: [{ name: "Client.txt", extensions: ["txt"] }],
    };
    const parent = this.windows.dashboard;
    const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    return !res.canceled && res.filePaths[0] ? res.filePaths[0] : null;
  }

  async readLogTail(file: string, bytes: number): Promise<string[]> {
    try {
      const size = (await fsp.stat(file)).size;
      const start = Math.max(0, size - bytes);
      const fh = await fsp.open(file, "r");
      try {
        const buf = Buffer.alloc(size - start);
        await fh.read(buf, 0, buf.length, start);
        const lines = buf.toString("utf8").split("\n");
        if (start > 0) lines.shift();
        return lines;
      } finally {
        await fh.close();
      }
    } catch {
      return []; // file missing: the follower will wait for it
    }
  }

  async scanLog(file: string, onLines: (lines: string[]) => void): Promise<void> {
    const size = (await fsp.stat(file)).size;
    if (size === 0) return;
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8", end: size - 1 }) });
    let batch: string[] = [];
    for await (const line of rl) {
      batch.push(line);
      if (batch.length >= kScanBatch) {
        onLines(batch);
        batch = [];
      }
    }
    if (batch.length) onLines(batch);
  }

  followLog(file: string, onLine: (line: string) => void, onError: (e: Error) => void): LogFollower {
    const t = new LogTailer(file, onLine, { onError });
    t.start();
    return {
      stop: () => t.stop(),
      get fileSeen() {
        return t.fileSeen;
      },
    };
  }

  async readClipboard(): Promise<string> {
    return clipboard.readText();
  }

  async writeClipboard(text: string): Promise<void> {
    clipboard.writeText(text);
  }

  openExternal(url: string): void {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
  }
}
