import type { AppConfig, AppState, DisplayInfo, TreeLayout } from "./types";

// NOTE: src/main/preload.ts duplicates these literals (a sandboxed preload cannot import
// local modules). test/ipc.test.ts fails if they drift apart.
export const CH = {
  stateGet: "state:get",
  state: "state",
  configSet: "config:set",
  logPick: "log:pick",
  logDetect: "log:detect",
  routeNext: "route:next",
  routePrev: "route:prev",
  routeReset: "route:reset",
  routeSync: "route:sync",
  pobImport: "pob:import",
  displaysList: "displays:list",
  dashboardMove: "dashboard:move",
  overlayToggle: "overlay:toggle",
  overlayInteractive: "overlay:interactive",
  priceResearch: "price:research",
  priceOpenTrade: "price:open-trade",
  farmPrices: "farm:prices",
  appAutostart: "app:autostart",
  diagCopy: "diag:copy",
  gemAdviceRefresh: "gems:refresh",
  treeLayout: "tree:layout",
  mapTradeOpen: "maps:trade",
  updateInstall: "update:install",
} as const;

export interface FarmPricesResult {
  league: string | null;
  chaosPerDivine: number | null;
  /** item name -> live price; items poe.ninja does not list are absent */
  prices: Record<string, { chaos: number; lowConfidence: boolean; variants: number }>;
  error: string | null;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
}

export interface HubApi {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): () => void;
  setConfig(patch: Partial<AppConfig>): Promise<void>;
  pickLog(): Promise<void>;
  detectLog(): Promise<string | null>;
  routeNext(): Promise<void>;
  routePrev(): Promise<void>;
  routeReset(): Promise<void>;
  routeSync(): Promise<boolean>;
  importPob(input: string): Promise<ImportResult>;
  listDisplays(): Promise<DisplayInfo[]>;
  moveDashboard(displayId: number, fullscreen: boolean): Promise<void>;
  toggleOverlay(): Promise<void>;
  toggleOverlayInteractive(): Promise<void>;
  priceResearch(patch: { statId: string; enabled: boolean; min: number | null }[]): Promise<void>;
  priceOpenTrade(): Promise<void>;
  farmPrices(): Promise<FarmPricesResult>;
  setStartWithWindows(on: boolean): Promise<void>;
  copyDiagReport(): Promise<void>;
  refreshGemAdvice(): Promise<void>;
  /** passive tree geometry for the map; null until GGG's tree data is loaded */
  getTreeLayout(): Promise<TreeLayout | null>;
  installUpdate(): Promise<void>;
  openMapTrade(o: {
    exclude: string[];
    minQuantity: number | null;
    minPackSize: number | null;
    tierMin: number | null;
    tierMax: number | null;
    rarity: "any" | "rare" | "magic" | "normal";
    corrupted: "any" | "yes" | "no";
  }): Promise<{ ok: boolean; total?: number; missing: string[]; error?: string }>;
}
