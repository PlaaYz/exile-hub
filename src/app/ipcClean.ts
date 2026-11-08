// Validation of everything the renderer sends to the main process. Pure (no Electron): tested.
import type { MapTradeOptions } from "../core/mapTrade";
import { MAP_MODS } from "../core/searchRegex";
import type { AppConfig } from "../shared/types";

export const DEFAULT_CONFIG: AppConfig = {
  clientLogPath: null,
  leagueStart: true,
  dashboardDisplayId: null,
  dashboardFullscreen: false,
  overlayEnabled: true,
  priceCheckEnabled: true,
  league: null,
  overlayHideUnfocused: true,
  showDashboardOnGameStart: true,
  gemAdviceEnabled: true,
};

type Kind = "boolean" | "string-or-null" | "internal";
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
  league: "string-or-null",
  overlayHideUnfocused: "boolean",
  showDashboardOnGameStart: "boolean",
  gemAdviceEnabled: "boolean",
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
  }
  return out as Partial<AppConfig>;
}

export function cleanResearch(patch: unknown): { statId: string; enabled: boolean; min: number | null }[] {
  if (!Array.isArray(patch)) return [];
  return patch
    .filter(
      (p): p is { statId: string; enabled: boolean; min: number | null } =>
        !!p &&
        typeof p.statId === "string" &&
        typeof p.enabled === "boolean" &&
        (p.min === null || (typeof p.min === "number" && Number.isFinite(p.min))),
    )
    .map((p) => ({ statId: p.statId, enabled: p.enabled, min: p.min }));
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
