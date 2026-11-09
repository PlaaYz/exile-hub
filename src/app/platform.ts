// What the app needs from the system. The services in src/app/ only talk to this interface, so the
// same code runs on Electron (src/main/electronPlatform.ts) and on Tauri (src/tauri/tauriPlatform.ts).
// Everything here is async: in Tauri these calls cross into Rust.
import type { DiagKind } from "../core/diag";
import type { TradeFetch } from "../core/trade";
import type { AppState, DisplayInfo, SuggestResult } from "../shared/types";

export interface LogFollower {
  stop(): void;
  /** the file exists and is being read */
  readonly fileSeen: boolean;
}

export interface PobEngineRequest {
  xml?: string;
  xmlKey: string;
  level: number;
  candidates: { id: string; name: string }[];
  maxSupports: number;
}

export interface PobEngineApi {
  readonly status: "off" | "starting" | "ready" | "missing-pob" | "error";
  suggest(req: PobEngineRequest): Promise<SuggestResult>;
  stop(): void;
}

export interface TrayState {
  tooltip: string;
  overlayEnabled: boolean;
  priceCheckEnabled: boolean;
  showDashboardOnGameStart: boolean;
  startWithWindows: boolean;
}

/** Everything the app does with windows, the tray and Windows itself. */
export interface Shell {
  /** sends the state to the dashboard and the overlay */
  send(state: AppState): void;
  readonly windowsReady: boolean;
  setOverlayVisible(visible: boolean): void;
  readonly overlayVisible: boolean;
  setOverlayInteractive(on: boolean): void;
  showDashboard(stealFocus: boolean): void;
  listDisplays(): Promise<DisplayInfo[]>;
  moveDashboard(displayId: number, fullscreen: boolean): Promise<void>;
  updateTray(t: TrayState): void;
  notify(title: string, body: string): void;
  startWithWindows(): Promise<boolean>;
  setStartWithWindows(on: boolean): Promise<void>;
  /** quit and install a downloaded update */
  installUpdate(): void;
  quit(): void;
}

export interface Platform {
  readonly appVersion: string;
  readonly packaged: boolean;
  readonly userAgent: string;
  /** HTTP for the app (trade, poe.ninja, GitHub raw): no CORS limits */
  readonly fetch: TradeFetch;
  /** a text download (PoB codes from pobb.in / pastebin); throws on HTTP errors */
  fetchText(url: string, timeoutMs: number): Promise<string>;

  // ---- app data shipped with the app (data/json, data/routes) ------------------------------
  readData(rel: string): Promise<string>;

  // ---- per-user files (settings, caches, progress) -----------------------------------------
  readUserFile(name: string): Promise<string | null>;
  writeUserFile(name: string, text: string): Promise<void>;
  /** last modification time (ms) or null when missing */
  userFileAge(name: string): Promise<number | null>;

  // ---- Client.txt ---------------------------------------------------------------------------
  /** the first Client.txt found in the usual install folders */
  detectLog(): Promise<string | null>;
  pickLogFile(): Promise<string | null>;
  /** the last `bytes` of the file as lines (first, probably cut, line dropped); [] when missing */
  readLogTail(path: string, bytes: number): Promise<string[]>;
  /** every line of the file, in batches, from the start up to its current size */
  scanLog(path: string, onLines: (lines: string[]) => void): Promise<void>;
  /** new lines appended from now on */
  followLog(path: string, onLine: (line: string) => void, onError: (e: Error) => void): LogFollower;

  // ---- clipboard / links -------------------------------------------------------------------
  readClipboard(): Promise<string>;
  /**
   * Calls onText with the clipboard text each time something is copied (not the current text).
   * Optional: without it the app polls readClipboard().
   */
  watchClipboard?(onText: (text: string) => void): () => void;
  writeClipboard(text: string): Promise<void>;
  openExternal(url: string): void;

  // ---- engines / windows --------------------------------------------------------------------
  readonly pob: PobEngineApi;
  readonly shell: Shell;
  /** diagnostics hook for platform-level events */
  diag?: (kind: DiagKind, text: string) => void;
}
