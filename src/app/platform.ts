// What the app needs from the system. The services in src/app/ only talk to this interface, so the
// same code runs on Electron (src/main/electronPlatform.ts) and on Tauri (src/tauri/tauriPlatform.ts).
// Everything here is async: in Tauri these calls cross into Rust.
import type { DiagKind } from "../core/diag";
import type { TradeFetch } from "../core/trade";
import type { AppState, DisplayInfo } from "../shared/types";

export interface LogFollower {
  stop(): void;
  /** the file exists and is being read */
  readonly fileSeen: boolean;
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
  /** the full price check next to the item, over the game (Ctrl+D); optional */
  showPricePopup?(): Promise<void>;
  hidePricePopup?(): void;
  /** the session summary window (game closed); optional: without it the summary is a notification */
  showSessionSummary?(): void;
  hideSessionSummary?(): void;
  /** the buy request cards window: shown while there are cards (`count` sizes it) */
  setTradeCards?(count: number): void;
  /** the game opened/closed (Client.txt): a shell may prepare or release the overlay window */
  gameRunningChanged?(running: boolean): void;
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

  // ---- chat commands (optional: only builds that can send input to the game) ----------------
  /** Registers these keys globally (replacing the previous set); [] unregisters them all. */
  setCommandKeys?(keys: string[], onPress: (key: string) => void): Promise<void>;
  /** Types one line in the game's chat (Enter, text, Enter); fails unless the game window is in front. */
  sendChat?(text: string): Promise<void>;
  /** Brings the game window to the front; false if it is not running or Windows refused. */
  focusGame?(): Promise<boolean>;
  /** Copies the item under the mouse with the game's advanced copy (Ctrl+Alt+C); game in front only. */
  copyItem?(): Promise<void>;

  // ---- windows ---------------------------------------------------------------------------------
  readonly shell: Shell;
  /** diagnostics hook for platform-level events */
  diag?: (kind: DiagKind, text: string) => void;
}
