// "Buy these maps" on the official trade site: the same choices as the Buscas tab (mods to avoid,
// minimum quantity...), turned into a trade search the site opens directly (?q=<query>), like
// poe.re's trade button. Map mods are matched to trade stat ids by their normalised text.
import { MAP_MODS } from "./searchRegex";
import type { TradeStatsData } from "./stats";

/** Lower case, no numbers/#/+, no "(x to y)" ranges, no "minus": both PoB and trade wordings meet. */
export function normaliseModText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\((?:[#\d.]*)\s*to\s*(?:[#\d.]*)\)/g, "")
    .replace(/\bminus\b/g, "")
    .replace(/[#+\d.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Our map mod id -> trade stat id (explicit), from the trade site's stat list. */
export function mapModStatIds(stats: TradeStatsData): Map<string, string> {
  const byText = new Map<string, string>();
  for (const group of stats.result) {
    if (group.id !== "explicit") continue;
    for (const e of group.entries) {
      const k = normaliseModText(e.text);
      if (!byText.has(k)) byText.set(k, e.id);
    }
  }
  const out = new Map<string, string>();
  for (const m of MAP_MODS) {
    const id = byText.get(normaliseModText(m.tradeText ?? m.text));
    if (id) out.set(m.id, id);
  }
  return out;
}

export interface MapTradeOptions {
  exclude: string[];
  minQuantity: number | null;
  minPackSize: number | null;
  tierMin: number | null;
  tierMax: number | null;
  /** "any" | "rare" | "magic" | "normal" (unique maps are never wanted here) */
  rarity: "any" | "rare" | "magic" | "normal";
  corrupted: "any" | "yes" | "no";
}

export function mapTradeQuery(o: MapTradeOptions, statIds: Map<string, string>): { query: object; missing: string[] } {
  const typeFilters: Record<string, unknown> = { category: { option: "map" } };
  typeFilters.rarity = { option: o.rarity === "any" ? "nonunique" : o.rarity };
  const mapFilters: Record<string, unknown> = {};
  if (o.tierMin || o.tierMax) mapFilters.map_tier = { ...(o.tierMin ? { min: o.tierMin } : {}), ...(o.tierMax ? { max: o.tierMax } : {}) };
  if (o.minQuantity) mapFilters.map_iiq = { min: o.minQuantity };
  if (o.minPackSize) mapFilters.map_packsize = { min: o.minPackSize };
  const filters: Record<string, { filters: Record<string, unknown> }> = { type_filters: { filters: typeFilters } };
  if (Object.keys(mapFilters).length) filters.map_filters = { filters: mapFilters };
  if (o.corrupted !== "any") filters.misc_filters = { filters: { corrupted: { option: o.corrupted === "yes" ? "true" : "false" } } };

  const missing: string[] = [];
  const not: { id: string }[] = [];
  for (const id of o.exclude) {
    const sid = statIds.get(id);
    if (sid) not.push({ id: sid });
    else missing.push(MAP_MODS.find((m) => m.id === id)?.label ?? id);
  }
  const stats: object[] = [{ type: "and", filters: [] }];
  if (not.length) stats.push({ type: "not", filters: not });
  return {
    query: { query: { status: { option: "online" }, stats, filters }, sort: { price: "asc" } },
    missing,
  };
}

/** The trade site opens a search given as ?q=<json> (no API call, no rate limit). */
export function tradeSearchUrl(league: string, query: object): string {
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}?q=${encodeURIComponent(JSON.stringify(query))}`;
}
