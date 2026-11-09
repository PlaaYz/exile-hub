// The Platform the app (src/app) runs on inside Tauri: Rust commands for files and Client.txt
// (src-tauri/src), Tauri plugins for HTTP, clipboard, dialogs and links.
import { Channel, invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { LogFollower, Platform } from "../app/platform";
import { candidateLogPaths } from "../core/clientLog";
import type { TradeFetch } from "../core/trade";
import { TauriPob } from "./tauriPob";
import type { TauriShell } from "./tauriShell";

const kHttpTimeoutMs = 15_000;

export interface AppInfo {
  version: string;
  packaged: boolean;
  hidden: boolean;
  userDir: string;
  pobVendorDir: string;
}

export class TauriPlatform implements Platform {
  readonly appVersion: string;
  readonly packaged: boolean;
  readonly userAgent: string;
  readonly pob: TauriPob;

  constructor(
    info: AppInfo,
    readonly shell: TauriShell,
  ) {
    this.appVersion = info.version;
    this.packaged = info.packaged;
    this.userAgent = `ExileHub/${info.version} (desktop companion; Windows)`;
    this.pob = new TauriPob({
      userDir: info.userDir,
      pobVendorDir: info.pobVendorDir,
      fetchText: (u, ms) => this.fetchText(u, ms),
      userFileAge: (n) => this.userFileAge(n),
      writeUserFile: (n, t) => this.writeUserFile(n, t),
    });
  }

  readonly fetch: TradeFetch = (url, init) =>
    httpFetch(url, { method: init?.method, headers: init?.headers, body: init?.body, signal: AbortSignal.timeout(kHttpTimeoutMs) });

  async fetchText(url: string, timeoutMs: number): Promise<string> {
    const res = await httpFetch(url, { headers: { "User-Agent": this.userAgent }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`falha no download (HTTP ${res.status})`);
    return res.text();
  }

  readData(rel: string): Promise<string> {
    return invoke("read_data", { rel });
  }
  readUserFile(name: string): Promise<string | null> {
    return invoke("read_user_file", { name });
  }
  writeUserFile(name: string, text: string): Promise<void> {
    return invoke("write_user_file", { name, text });
  }
  userFileAge(name: string): Promise<number | null> {
    return invoke("user_file_age", { name });
  }

  detectLog(): Promise<string | null> {
    return invoke("first_existing", { paths: candidateLogPaths() });
  }

  async pickLogFile(): Promise<string | null> {
    const file = await open({
      title: "Selecione o logs/Client.txt do Path of Exile",
      multiple: false,
      directory: false,
      filters: [{ name: "Client.txt", extensions: ["txt"] }],
    });
    return typeof file === "string" ? file : null;
  }

  readLogTail(path: string, bytes: number): Promise<string[]> {
    return invoke("log_tail", { path, bytes });
  }

  async scanLog(path: string, onLines: (lines: string[]) => void): Promise<void> {
    // channel messages can still be in flight when the command returns: wait for all of them
    let received = 0;
    let total = Infinity;
    let done: () => void = () => {};
    const all = new Promise<void>((r) => (done = r));
    const ch = new Channel<string[]>();
    ch.onmessage = (lines) => {
      received += lines.length;
      onLines(lines);
      if (received >= total) done();
    };
    total = await invoke<number>("log_scan", { path, onLines: ch });
    if (received >= total) done();
    await all;
  }

  followLog(path: string, onLine: (line: string) => void, onError: (e: Error) => void): LogFollower {
    let seen = false;
    let stopped = false;
    const ch = new Channel<{ lines: string[]; fileSeen: boolean; error: string | null }>();
    ch.onmessage = (m) => {
      if (stopped) return;
      if (m.fileSeen) seen = true;
      if (m.error) onError(new Error(m.error));
      for (const l of m.lines) onLine(l);
    };
    const id = invoke<number>("log_follow", { path, onMsg: ch });
    id.catch((e: unknown) => onError(new Error(String(e))));
    return {
      stop: () => {
        stopped = true;
        void id.then((x) => invoke("log_unfollow", { id: x })).catch(() => {});
      },
      get fileSeen() {
        return seen;
      },
    };
  }

  async readClipboard(): Promise<string> {
    return readText();
  }
  watchClipboard(onText: (text: string) => void): () => void {
    const ch = new Channel<string>();
    let stopped = false;
    ch.onmessage = (t) => {
      if (!stopped) onText(t);
    };
    void invoke("clipboard_watch", { onText: ch });
    return () => {
      stopped = true;
      void invoke("clipboard_unwatch");
    };
  }
  private commandKeys: string[] = [];
  private keyChain: Promise<void> = Promise.resolve();
  /**
   * Global shortcuts for chat commands (replaces the previous set; F9/F10 are separate). Calls are
   * queued: alt-tab flips focus quickly and register/unregister must not interleave.
   */
  setCommandKeys(keys: string[], onPress: (key: string) => void): Promise<void> {
    const run = async () => {
      if (this.commandKeys.length) await unregister(this.commandKeys).catch(() => {});
      this.commandKeys = [];
      for (const key of keys) {
        await register(key, (e) => {
          if (e.state === "Pressed") onPress(key);
        });
        this.commandKeys.push(key);
      }
    };
    const p = this.keyChain.then(run);
    this.keyChain = p.catch(() => {});
    return p;
  }
  sendChat(text: string): Promise<void> {
    return invoke("send_chat", { text });
  }
  writeClipboard(text: string): Promise<void> {
    return writeText(text);
  }
  openExternal(url: string): void {
    if (/^https:\/\//.test(url)) void openUrl(url);
  }
}
