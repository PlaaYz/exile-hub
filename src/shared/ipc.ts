import type { AppConfig, AppState, ChallengesView, DisplayInfo, PriceSearchPatch, TreeLayout } from "./types";

// What the windows can ask the app (window.hub). On Tauri the dashboard calls the app directly and the
// overlay goes through events (src/tauri/boot.ts).

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
  /** re-run the trade search with these mods and filters */
  priceResearch(patch: PriceSearchPatch): Promise<void>;
  priceOpenTrade(): Promise<void>;
  /** the next 10 trade listings of the current search */
  priceMore(): Promise<void>;
  farmPrices(): Promise<FarmPricesResult>;
  setStartWithWindows(on: boolean): Promise<void>;
  copyDiagReport(): Promise<void>;
  /** passive tree geometry for the map; null until GGG's tree data is loaded */
  getTreeLayout(): Promise<TreeLayout | null>;
  /** close the price popup and give the keyboard back to the game */
  closePricePopup(): Promise<void>;
  /** pick who is playing (one of state.knownCharacters) */
  setCharacter(name: string): Promise<void>;
  getChallenges(): Promise<ChallengesView>;
  refreshChallenges(): Promise<ChallengesView>;
  /** tick a challenge (part = index of a sub-objective, or null for the whole challenge) */
  setChallenge(id: string, done: boolean, part: number | null): Promise<ChallengesView>;
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
