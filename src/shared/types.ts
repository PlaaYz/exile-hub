// RECONSTRUCTED: the original file was overwritten by mistake and rebuilt from how the other
// modules use these types (the compiled output of a types-only file is empty). Compare with
// your own copy if you have one.

import type { DiagEntry } from "../core/diag";
export interface SessionView {
  start: number;
  end: number | null;
  durationMs: number;
  /** ended without "Closing game gracefully" (crash) */
  abrupt: boolean;
  characters: { name: string; className: string; from: number; to: number }[];
  deaths: number;
  maps: number;
  bossRuns: number;
  zones: number;
  passives: number;
  /** items price-checked during the session (only while the app was running) */
  priceChecks: number;
  bestPrice: { name: string; chaos: number } | null;
}

import type { MapStats } from "../core/maps";
export type { DiagEntry, MapStats };

// ---- route ------------------------------------------------------------------

export type Fragment =
  | { kind: "text"; text: string }
  | { kind: "enter"; areaId: string; name: string }
  | { kind: "area"; areaId: string; name: string }
  | { kind: "waypoint"; areaId?: string; name?: string }
  | { kind: "waypoint_get" }
  | { kind: "quest"; ids: string[]; name: string }
  | { kind: "label"; style: "kill" | "arena" | "quest_text" | "generic" | "reward_quest"; text: string }
  | { kind: "reward_vendor"; text: string; cost?: string }
  | { kind: "logout" }
  | { kind: "trial" }
  | { kind: "crafting" }
  | { kind: "dir"; degrees: number }
  | { kind: "portal"; mode: string }
  | { kind: "ascend"; version: string }
  | { kind: "copy"; text: string };

export interface Step {
  id: number;
  act: number;
  fragments: Fragment[];
  subs: Fragment[][];
  comment?: string;
  /** area id this step marks arrival in, if any */
  arrival?: string;
}

export interface TrackerView {
  cursor: number;
  total: number;
  areaId: string | null;
  offRoute: boolean;
  act: number;
  block: Step[];
  next: Step | null;
  done: boolean;
}

export interface TimerSnapshot {
  runMs: number;
  act: number | null;
  actMs: number;
  splits: Record<number, number>;
}

// ---- Path of Building ---------------------------------------------------------

export interface PobGem {
  name: string;
  level: number;
  quality: number;
  enabled: boolean;
  support: boolean;
  requiredLevel: number | null;
}

export interface PobSkillGroup {
  label: string;
  slot: string | null;
  enabled: boolean;
  gems: PobGem[];
}

export interface PobBuild {
  className: string;
  ascendClass: string;
  level: number;
  groups: PobSkillGroup[];
  treeNodes: number[];
}

// ---- price check ----------------------------------------------------------------

export type FetchStatus = "idle" | "loading" | "done" | "error" | "n/a";

export interface PriceModFilter {
  text: string;
  /** explicit, implicit, crafted, fractured, enchant... or "pseudo" (a total the trade site computes) */
  kind: string;
  statId: string;
  value: number | null;
  min: number | null;
  max?: number | null;
  enabled: boolean;
}

/** A number filter of the search: on/off, min and max (null = open). */
export interface PriceRange {
  enabled: boolean;
  min: number | null;
  max: number | null;
}

/** Everything about the trade search besides the mods; null = does not apply to this item. */
export interface PriceFilters {
  /** only sellers online now */
  online: boolean;
  /** rares/magic: only this base type (else the whole category, e.g. any helmet) */
  baseType: boolean;
  itemLevel: PriceRange | null;
  quality: PriceRange | null;
  links: PriceRange | null;
  gemLevel: PriceRange | null;
  mapTier: PriceRange | null;
  corrupted: "any" | "yes" | "no";
  influences: { name: string; enabled: boolean }[];
  pdps: PriceRange | null;
  edps: PriceRange | null;
  dps: PriceRange | null;
  armour: PriceRange | null;
  evasion: PriceRange | null;
  es: PriceRange | null;
  ward: PriceRange | null;
}

/** What the player changed in the search (popup / panel). */
export interface PriceSearchPatch {
  mods: { statId: string; enabled: boolean; min: number | null; max: number | null }[];
  filters: PriceFilters;
}

export interface PriceListing {
  amount: number;
  currency: string;
  chaos: number | null;
  indexed: string;
}

export interface PriceView {
  seq: number;
  at: number;
  league: string;
  item: {
    name: string;
    baseType: string;
    rarity: string;
    itemClass: string;
    itemLevel: number | null;
    gemLevel: number | null;
    quality: number;
    links: number;
    corrupted: boolean;
    stackSize: number | null;
    /** every mod line, with tier / roll when copied with Ctrl+Alt+C */
    mods: { text: string; kind: string; affix?: "prefix" | "suffix"; tier?: number; rank?: number; roll?: number }[];
    affixes: { prefix: number; suffix: number; maxPrefix: number; maxSuffix: number } | null;
  };
  ninjaStatus: FetchStatus;
  ninjaError: string | null;
  ninja: { chaos: number; divine: number | null; label: string; listings: number | null; lowConfidence: boolean } | null;
  tradeStatus: FetchStatus;
  tradeError: string | null;
  trade: { total: number; url: string; listings: PriceListing[]; medianChaos: number | null } | null;
  mods: PriceModFilter[];
  /** mod lines that could not be mapped to a trade stat */
  unmatched: string[];
  chaosPerDivine: number | null;
  filters: PriceFilters;
  /** computed from the item: weapon DPS and defences, now and at 20% quality */
  calc: {
    dps: { pdps: number; edps: number; cdps: number; dps: number; pdpsQ20: number; dpsQ20: number } | null;
    def: {
      armour: number | null;
      evasion: number | null;
      es: number | null;
      ward: number | null;
      armourQ20: number | null;
      evasionQ20: number | null;
      esQ20: number | null;
    } | null;
  };
}

// ---- app ----------------------------------------------------------------------

export interface AppConfig {
  clientLogPath: string | null;
  leagueStart: boolean;
  dashboardDisplayId: number | null;
  dashboardFullscreen: boolean;
  overlayEnabled: boolean;
  /** watch the clipboard for items copied in game (Ctrl+C) and price them */
  priceCheckEnabled: boolean;
  /** key that copies the item under the mouse (Ctrl+Alt+C) and opens the price popup; null = off */
  priceCheckKey: string | null;
  /** trade league id; null = current challenge league */
  league: string | null;
  /** hide the overlay while the game is in the background (from Client.txt focus lines) */
  overlayHideUnfocused: boolean;
  /** bring the dashboard up (without stealing focus) when the log shows the game starting */
  showDashboardOnGameStart: boolean;
  /** where the player left the overlay (physical pixels); null = top-left of the primary monitor */
  overlayPos: { x: number; y: number } | null;
  /** chat commands on keys (F5 -> /hideout), only while the game has focus */
  chatCommandsEnabled: boolean;
  chatCommands: { key: string; text: string }[];
}

/** League challenges for the panel: the list (null if none could be loaded) and what the player ticked. */
export interface ChallengesView {
  list: import("../core/challenges").ChallengeList | null;
  progress: import("../core/challenges").ChallengeProgress;
  error: string | null;
}

/** Main passive tree geometry for the map: [id, x, y, kind 0 small/1 notable/2 keystone/3 start], edges by id. */
export interface TreeLayout {
  nodes: [number, number, number, number][];
  /** [a, b] straight, or [a, b, radius, sweep] an arc on a group's orbit (SVG arc sweep flag) */
  edges: ([number, number] | [number, number, number, number])[];
  /** node id -> name (tooltips, the "take next" list) */
  names: Record<number, string>;
}

export interface DisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  primary: boolean;
}

export type Panel =
  | "campaign"
  | "price"
  | "maps"
  | "sessions"
  | "farm"
  | "search"
  | "build"
  | "challenges"
  | "timers"
  | "settings"
  | "diag";

export interface AppState {
  config: AppConfig;
  logStatus: "no-path" | "waiting" | "watching" | "error";
  logError: string | null;
  areaId: string | null;
  areaName: string | null;
  characterName: string | null;
  className: string | null;
  characterLevel: number | null;
  tracker: TrackerView;
  timers: TimerSnapshot;
  build: PobBuild | null;
  /** boss runs found in Client.txt, by FARM_BOSSES id; minutes = measured time per run */
  farmRuns: Record<
    string,
    { runs: number; minutes: number | null; fightSec: number | null; deaths: number; lastRunAt: number | null }
  >;
  /** Windows login item registered (read from the OS, not the config file) */
  startWithWindows: boolean;
  /** automatic updates (installed app only) */
  update: {
    status: "disabled" | "checking" | "latest" | "downloading" | "ready" | "error";
    current: string;
    /** the new version being downloaded / ready */
    version: string | null;
    progress: number | null;
    message: string | null;
  };
  /** play sessions (one per game start) from Client.txt: the open one and the last closed ones */
  sessions: {
    current: SessionView | null;
    recent: SessionView[];
  };
  /** the build's main link and its socket colors ("r"/"g"/"b"), for the vendor search */
  buildLinks: { label: string; gems: string[]; colors: string[] } | null;
  /** playing endgame (maps...): the campaign route is paused and the overlay shows maps */
  endgame: boolean;
  /** the account's characters seen leveling up in the log, most recent first (to pick who is playing) */
  knownCharacters: { name: string; className: string; level: number }[];
  /** chat commands on keys: supported by this build, keys registered now, last whisperer */
  chat: { supported: boolean; active: boolean; lastWhisper: string | null };
  /** what the app understood recently (Diagnóstico tab) */
  diag: {
    entries: DiagEntry[];
    lastLineAt: number | null;
    linesSeen: number;
    gameRunning: boolean;
    gameFocused: boolean;
    overlayVisible: boolean;
    clipboardWatch: boolean;
    version: string;
  };
  /** map runs found in Client.txt (whole log at start, then live) */
  maps: MapStats;
  /** passive tree of the current character (from Client.txt) vs the PoB build; null without a build */
  tree: {
    status: "loading" | "no-character" | "ok" | "inconsistent";
    character: string | null;
    level: number | null;
    /** points the log showed for this character, and what its level allows */
    pointsSeen: number;
    budget: number;
    progress: {
      buildPoints: number;
      donePoints: number;
      missing: { id: number; name: string; kind: "notable" | "keystone"; stats: string[]; distance: number | null }[];
      ascMissing: string[];
      offBuild: string[];
      /** for the tree map (geometry comes once from getTreeLayout) */
      buildIds: number[];
      haveIds: number[];
      /** points to take next, in order */
      nextPath: number[];
      startId: number | null;
    } | null;
  } | null;
  /** where the current build came from: pasted, picked up from the clipboard, or restored */
  buildInfo: { source: "manual" | "clipboard" | "saved"; at: number } | null;
  overlayInteractive: boolean;
  price: PriceView | null;
  /** league actually used for prices (config.league or the detected challenge league) */
  league: string | null;
  leagues: string[];
}
