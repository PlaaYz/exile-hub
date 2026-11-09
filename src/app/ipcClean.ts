// Validation of everything the renderer sends to the main process. Pure (no Electron): tested.
import { cleanChatCommands, DEFAULT_CHAT_COMMANDS, isValidKey, normaliseKey } from "../core/chatCommands";
import type { MapTradeOptions } from "../core/mapTrade";
import { MAP_MODS } from "../core/searchRegex";
import type { AppConfig, PriceFilters, PriceRange, PriceSearchPatch } from "../shared/types";

export const DEFAULT_CONFIG: AppConfig = {
  clientLogPath: null,
  leagueStart: true,
  dashboardDisplayId: null,
  dashboardFullscreen: false,
  overlayEnabled: true,
  priceCheckEnabled: true,
  priceCheckKey: "Ctrl+D",
  league: null,
  overlayHideUnfocused: true,
  showDashboardOnGameStart: true,
  chatCommandsEnabled: true,
  chatCommands: DEFAULT_CHAT_COMMANDS,
  overlayPos: null,
};

type Kind = "boolean" | "string-or-null" | "internal" | "chat-commands" | "hotkey";
/**
 * How each config key may be set from the renderer. Every AppConfig key must be listed (the
 * compiler enforces it), so a new setting cannot silently be ignored by the settings screen.
 * "internal" keys are only changed by the main process (e.g. through moveDashboard).
 */
const CONFIG_KEYS: Record<keyof AppConfig, Kind> = {
  clientLogPath: "string-or-null",
  leagueStart: "boolean",
  dashboardDisplayId: "internal",
  dashboardFullscreen: "boolean",
  overlayEnabled: "boolean",
  priceCheckEnabled: "boolean",
  priceCheckKey: "hotkey",
  league: "string-or-null",
  overlayHideUnfocused: "boolean",
  showDashboardOnGameStart: "boolean",
  chatCommandsEnabled: "boolean",
  chatCommands: "chat-commands",
  overlayPos: "internal",
};

/** Only known keys with the right primitive type. */
export function cleanConfigPatch(patch: unknown): Partial<AppConfig> {
  const p = (patch ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(CONFIG_KEYS) as [keyof AppConfig, Kind][]) {
    if (!(key in p)) continue;
    const v = p[key];
    if (kind === "boolean" && typeof v === "boolean") out[key] = v;
    if (kind === "string-or-null" && (typeof v === "string" || v === null)) out[key] = v;
    if (kind === "hotkey" && (v === null || (typeof v === "string" && isValidKey(v)))) out[key] = v === null ? null : normaliseKey(v);
    if (kind === "chat-commands") {
      const cmds = cleanChatCommands(v);
      if (cmds) out[key] = cmds;
    }
  }
  return out as Partial<AppConfig>;
}

export function cleanChallengeTick(id: unknown, done: unknown, part: unknown): { id: string; done: boolean; part: number | null } | null {
  if (typeof id !== "string" || id.length === 0 || id.length > 40 || typeof done !== "boolean") return null;
  if (part !== null && part !== undefined && !(typeof part === "number" && Number.isInteger(part) && part >= 0 && part < 100)) return null;
  return { id, done, part: typeof part === "number" ? part : null };
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e7 ? v : null);

function cleanRange(v: unknown): PriceRange | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  return { enabled: r.enabled === true, min: numOrNull(r.min), max: numOrNull(r.max) };
}

/**
 * A re-search from a window (popup / panel): mods by stat id with min/max, and the filters with
 * known keys only. Returns null when it is not a search patch at all.
 */
export function cleanSearchPatch(patch: unknown): PriceSearchPatch | null {
  const p = patch as Record<string, unknown> | null;
  if (!p || typeof p !== "object" || !Array.isArray(p.mods) || !p.filters || typeof p.filters !== "object") return null;
  const mods = (p.mods as Record<string, unknown>[])
    .filter((m) => !!m && typeof m.statId === "string" && m.statId.length < 200 && typeof m.enabled === "boolean")
    .slice(0, 80)
    .map((m) => ({ statId: m.statId as string, enabled: m.enabled as boolean, min: numOrNull(m.min), max: numOrNull(m.max) }));
  const f = p.filters as Record<string, unknown>;
  const corrupted = f.corrupted === "yes" || f.corrupted === "no" ? f.corrupted : "any";
  const filters: PriceFilters = {
    online: f.online !== false,
    baseType: f.baseType === true,
    itemLevel: cleanRange(f.itemLevel),
    quality: cleanRange(f.quality),
    links: cleanRange(f.links),
    gemLevel: cleanRange(f.gemLevel),
    mapTier: cleanRange(f.mapTier),
    corrupted,
    influences: Array.isArray(f.influences)
      ? (f.influences as Record<string, unknown>[])
          .filter((i) => !!i && typeof i.name === "string" && i.name.length < 30)
          .slice(0, 8)
          .map((i) => ({ name: i.name as string, enabled: i.enabled === true }))
      : [],
    pdps: cleanRange(f.pdps),
    edps: cleanRange(f.edps),
    dps: cleanRange(f.dps),
    armour: cleanRange(f.armour),
    evasion: cleanRange(f.evasion),
    es: cleanRange(f.es),
    ward: cleanRange(f.ward),
  };
  return { mods, filters };
}

/** Renderer input for the map trade search: known keys, sane numbers, known mod ids only. */
export function cleanMapTradeOptions(o: unknown): MapTradeOptions {
  const x = (o ?? {}) as Record<string, unknown>;
  const num = (v: unknown, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(max, Math.round(v)) : null;
  const known = new Set(MAP_MODS.map((m) => m.id));
  return {
    exclude: Array.isArray(x.exclude) ? x.exclude.filter((id): id is string => typeof id === "string" && known.has(id)) : [],
    minQuantity: num(x.minQuantity, 500),
    minPackSize: num(x.minPackSize, 500),
    tierMin: num(x.tierMin, 17),
    tierMax: num(x.tierMax, 17),
    rarity: x.rarity === "rare" || x.rarity === "magic" || x.rarity === "normal" ? x.rarity : "any",
    corrupted: x.corrupted === "yes" || x.corrupted === "no" ? x.corrupted : "any",
  };
}
