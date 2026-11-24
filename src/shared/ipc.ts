import type { AppConfig, AppState, ChallengesView, DisplayInfo, TradeAction, TreeLayout } from "./types";

// What the windows can ask the app (window.hub). On Tauri the dashboard calls the app directly and the
// overlay goes through events (src/tauri/boot.ts).

export interface FarmPricesResult {
  league: string | null;
  chaosPerDivine: number | null;
  /** item name -> live poe.ninja price; items with no price are absent */
  prices: Record<string, { chaos: number; lowConfidence: boolean; variants: number }>;
  /** poe.ninja prices ignored as joke listings: the item counts as 0 */
  suspect: string[];
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
  /** check one of state.priceRecent again (fresh prices, no copying in the game) */
  priceRecheck(id: number): Promise<void>;
  /** shows another stage of the imported build (index in build.stages) */
  setBuildStage(stage: number): Promise<void>;
  /** copy the diagnostic report and open a new GitHub issue to paste it in */
  reportProblem(): Promise<void>;
  /** Opens the donation page (only when the app has one; voluntary, unlocks nothing). */
  openDonate(): Promise<void>;
  /** puts a short text on the clipboard (a gem name to paste in the vendor's search) */
  copyText(text: string): Promise<void>;
  /** "register my equipment" on/off: while on, items copied with the price key are kept as what you wear */
  setGearRegister(on: boolean): Promise<void>;
  /** closes the session summary window */
  closeSessionSummary(): Promise<void>;
  removeGear(slot: string): Promise<void>;
  farmPrices(): Promise<FarmPricesResult>;
  setStartWithWindows(on: boolean): Promise<void>;
  copyDiagReport(): Promise<void>;
  /** passive tree geometry for the map; null until GGG's tree data is loaded */
  getTreeLayout(): Promise<TreeLayout | null>;
  /** a button on a buy request card: chat command to the buyer, or close the card */
  tradeAction(id: string, action: TradeAction): Promise<void>;
  /** close the price popup and give the keyboard back to the game */
  closePricePopup(): Promise<void>;
  /** pick who is playing (one of state.knownCharacters) */
  setCharacter(name: string): Promise<void>;
  getChallenges(): Promise<ChallengesView>;
  refreshChallenges(): Promise<ChallengesView>;
  /** tick a challenge (part = index of a sub-objective, or null for the whole challenge) */
  setChallenge(id: string, done: boolean, part: number | null): Promise<ChallengesView>;
  installUpdate(): Promise<void>;
}
