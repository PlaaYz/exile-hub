// poe.ninja price estimates (the 2025+ "poe1/api/economy" endpoints).
//  - exchange overview: stackables (currency, cards, fragments, scarabs...) -> lines[].primaryValue in chaos
//  - stash item overview: uniques, gems... -> lines[].chaosValue, with links / gem level / quality
import type { ParsedItem } from "./item";

export type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const BASE = "https://poe.ninja/poe1/api/economy";
export const kNinjaTtlMs = 30 * 60 * 1000;
/** Lines with fewer listings than this are flagged as unreliable. */
export const kLowConfidenceListings = 5;

export const EXCHANGE_TYPES = [
  "Currency",
  "Fragment",
  "DivinationCard",
  "Scarab",
  "Essence",
  "Fossil",
  "Resonator",
  "Oil",
  "DeliriumOrb",
  "Omen",
  "Tattoo",
  "Artifact",
  "Runegraft",
  "Astrolabe",
  "AllflameEmber",
] as const;

const UNIQUE_TYPE_BY_CLASS: [RegExp, string][] = [
  [/^(Body Armours|Boots|Gloves|Helmets|Shields|Quivers)$/, "UniqueArmour"],
  [/^(Amulets|Rings|Belts|Trinkets)$/, "UniqueAccessory"],
  [/Flasks$/, "UniqueFlask"],
  [/Jewels$/, "UniqueJewel"],
  [/^Maps$/, "UniqueMap"],
  [/^Tinctures$/, "UniqueTincture"],
  [/^Relics$/, "UniqueRelic"],
  [/(Bows|Claws|Daggers|Axes|Maces|Swords|Sceptres|Staves|Warstaves|Wands|Fishing Rods)$/, "UniqueWeapon"],
];
const ALL_UNIQUE_TYPES = [...new Set(UNIQUE_TYPE_BY_CLASS.map(([, t]) => t))];

export interface ExchangeOverview {
  core?: { rates?: Record<string, number>; primary?: string };
  lines: { id: string; primaryValue: number; volumePrimaryValue?: number; sparkline?: Sparkline }[];
  items: { id: string; name: string; category?: string }[];
}

export interface StashLine {
  name: string;
  baseType?: string;
  links?: number;
  variant?: string;
  gemLevel?: number;
  gemQuality?: number;
  corrupted?: boolean;
  /** item art on GGG's image server (web.poecdn.com) */
  icon?: string;
  chaosValue: number;
  divineValue?: number;
  listingCount?: number;
  sparkLine?: Sparkline;
}

/** poe.ninja's last 7 days: % change against a week ago, one point per day (the last one = totalChange). */
export interface Sparkline {
  totalChange?: number;
  data?: (number | null)[];
}

export interface PriceTrend {
  /** % change over the last 7 days */
  change: number;
  /** daily % changes against a week ago, oldest first */
  points: number[];
}

/** A usable 7-day trend, or null when poe.ninja has too few points. */
export function trendOf(s: Sparkline | undefined): PriceTrend | null {
  const points = (s?.data ?? []).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (points.length < 2) return null;
  const change = typeof s?.totalChange === "number" ? s.totalChange : points[points.length - 1];
  return { change: Math.round(change * 10) / 10, points };
}

export interface NinjaPrice {
  chaos: number;
  divine: number | null;
  /** what was matched, e.g. "Tabula Rasa (6L)" or "Cyclone 20/20" */
  label: string;
  listings: number | null;
  lowConfidence: boolean;
  /** price over the last 7 days (null when poe.ninja has no history for it) */
  trend: PriceTrend | null;
}

interface CacheEntry<T> {
  at: number;
  data: Promise<T>;
}

export class NinjaClient {
  private cache = new Map<string, CacheEntry<unknown>>();

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly userAgent: string,
    private readonly now: () => number = Date.now,
  ) {}

  private get<T>(url: string): Promise<T> {
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < kNinjaTtlMs) return hit.data as Promise<T>;
    const data = (async () => {
      const res = await this.fetchFn(url, { headers: { "User-Agent": this.userAgent } });
      if (!res.ok) throw new Error(`poe.ninja HTTP ${res.status}`);
      return (await res.json()) as T;
    })();
    this.cache.set(url, { at: this.now(), data });
    data.catch(() => this.cache.delete(url)); // retry next time
    return data;
  }

  exchange(league: string, type: string): Promise<ExchangeOverview> {
    return this.get(`${BASE}/exchange/current/overview?league=${encodeURIComponent(league)}&type=${type}`);
  }

  stash(league: string, type: string): Promise<{ lines: StashLine[] }> {
    return this.get(`${BASE}/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${type}`);
  }

  /** chaos value of one unit of each exchange item id (e.g. "divine" -> 686), from the Currency overview. */
  async currencyRates(league: string): Promise<Map<string, number>> {
    const ov = await this.exchange(league, "Currency");
    const out = new Map<string, number>([["chaos", 1]]);
    for (const l of ov.lines) out.set(l.id, l.primaryValue);
    const divPerChaos = ov.core?.rates?.divine;
    if (divPerChaos && divPerChaos > 0) out.set("divine", 1 / divPerChaos);
    return out;
  }

  async price(league: string, item: ParsedItem): Promise<NinjaPrice | null> {
    const divine = (await this.currencyRates(league).catch(() => null))?.get("divine") ?? null;
    const withDiv = (p: Omit<NinjaPrice, "divine">): NinjaPrice => ({ ...p, divine: divine ? p.chaos / divine : null });

    if (item.rarity === "Unique") {
      if (!item.name) return null; // unidentified
      const m = UNIQUE_TYPE_BY_CLASS.find(([re]) => re.test(item.itemClass));
      const types = m ? [m[1]] : ALL_UNIQUE_TYPES;
      for (const t of types) {
        const line = pickUnique((await this.stash(league, t)).lines, item);
        if (line) return withDiv(fromStash(line, uniqueLabel(line)));
      }
      return null;
    }

    if (/Gem/.test(item.rarity)) {
      const line = pickGem((await this.stash(league, "SkillGem")).lines, item);
      return line ? withDiv(fromStash(line, `${line.name} ${line.gemLevel ?? "?"}/${line.gemQuality ?? 0}${line.corrupted ? " (corrompida)" : ""}`)) : null;
    }

    if (item.rarity === "Currency" || item.rarity === "Divination Card" || item.itemClass === "Map Fragments") {
      for (const t of EXCHANGE_TYPES) {
        const ov = await this.exchange(league, t).catch(() => null);
        if (!ov) continue;
        const meta = ov.items.find((i) => i.name === item.name);
        if (!meta) continue;
        const line = ov.lines.find((l) => l.id === meta.id);
        if (!line) continue;
        return withDiv({ chaos: line.primaryValue, label: meta.name, listings: null, lowConfidence: false, trend: trendOf(line.sparkline) });
      }
      return null;
    }
    return null;
  }
}

/**
 * The item's art as poe.ninja shows it: a unique's own picture, else its base type's (the plain one when
 * poe.ninja also lists influenced variants). null when poe.ninja has none.
 */
export async function iconFor(ninja: NinjaClient, league: string, item: ParsedItem): Promise<string | null> {
  const ok = (u: string | undefined) => (u && /^https:\/\/web\.poecdn\.com\//.test(u) ? u : null);
  if (item.rarity === "Unique" && item.name) {
    const m = UNIQUE_TYPE_BY_CLASS.find(([re]) => re.test(item.itemClass));
    for (const t of m ? [m[1]] : ALL_UNIQUE_TYPES) {
      const line = (await ninja.stash(league, t)).lines.find((l) => l.name === item.name && l.icon);
      if (line) return ok(line.icon);
    }
  }
  const bases = (await ninja.stash(league, "BaseType")).lines.filter((l) => l.name === item.baseType && l.icon);
  return ok((bases.find((l) => !l.variant) ?? bases[0])?.icon);
}

/** Stash overviews looked at by name lookups, after the exchange ones. */
const NAME_STASH_TYPES = ["Invitation", ...ALL_UNIQUE_TYPES, "SkillGem"];

export interface NamePrice {
  chaos: number;
  listings: number | null;
  lowConfidence: boolean;
  /** poe.ninja lines with this name (e.g. Watcher's Eye mods); with several, the median is used */
  variants: number;
}

/**
 * Price of an item by name alone (farm EV tables): exchange first (currency, cards, fragments...),
 * then invitations, uniques and gems. Several lines with the same name -> their median price.
 * Gems: the plain level 1 / 0% / uncorrupted line when present.
 */
export async function priceByName(ninja: NinjaClient, league: string, names: string[]): Promise<Map<string, NamePrice>> {
  const want = new Set(names);
  const out = new Map<string, NamePrice>();
  for (const t of EXCHANGE_TYPES) {
    if (out.size === want.size) return out;
    const ov = await ninja.exchange(league, t).catch(() => null);
    if (!ov) continue;
    const byId = new Map(ov.lines.map((l) => [l.id, l]));
    for (const it of ov.items) {
      if (!want.has(it.name) || out.has(it.name)) continue;
      const l = byId.get(it.id);
      if (l) out.set(it.name, { chaos: l.primaryValue, listings: null, lowConfidence: false, variants: 1 });
    }
  }
  for (const t of NAME_STASH_TYPES) {
    if (out.size === want.size) return out;
    const ov = await ninja.stash(league, t).catch(() => null);
    if (!ov) continue;
    const groups = new Map<string, StashLine[]>();
    for (const l of ov.lines) {
      if (!want.has(l.name) || out.has(l.name)) continue;
      if (l.links) continue; // 5L/6L variants are not what a boss drops
      const g = groups.get(l.name) ?? [];
      g.push(l);
      groups.set(l.name, g);
    }
    for (const [name, lines] of groups) {
      let pool = lines;
      if (t === "SkillGem") {
        const plain = lines.filter((l) => !l.corrupted && (l.gemQuality ?? 0) === 0);
        if (plain.length) pool = [plain.reduce((a, b) => ((a.gemLevel ?? 1) <= (b.gemLevel ?? 1) ? a : b))];
      }
      // ignore lines with too few listings when better-supported ones exist
      const solid = pool.filter((l) => (l.listingCount ?? 0) >= kLowConfidenceListings);
      const use = (solid.length ? solid : pool).sort((a, b) => a.chaosValue - b.chaosValue);
      // a boss drops a random variant (Forbidden Flame ascendancy, Watcher's Eye mods...): median
      const mid = use.length >> 1;
      const chaos = use.length % 2 ? use[mid].chaosValue : (use[mid - 1].chaosValue + use[mid].chaosValue) / 2;
      const listings = use.reduce((a, l) => a + (l.listingCount ?? 0), 0) || null;
      out.set(name, {
        chaos,
        listings,
        lowConfidence: !solid.length && listings !== null && listings < kLowConfidenceListings,
        variants: lines.length,
      });
    }
  }
  return out;
}

function fromStash(line: StashLine, label: string): Omit<NinjaPrice, "divine"> {
  const listings = line.listingCount ?? null;
  return {
    chaos: line.chaosValue,
    label,
    listings,
    lowConfidence: listings !== null && listings < kLowConfidenceListings,
    trend: trendOf(line.sparkLine),
  };
}

function uniqueLabel(l: StashLine): string {
  const extra = [l.links ? `${l.links}L` : "", l.variant ?? ""].filter(Boolean).join(", ");
  return extra ? `${l.name} (${extra})` : l.name;
}

export function pickUnique(lines: StashLine[], item: ParsedItem): StashLine | null {
  const same = lines.filter((l) => l.name === item.name && (!l.baseType || l.baseType === item.baseType));
  if (!same.length) return null;
  const wantLinks = item.links >= 5 ? item.links : 0;
  return same.find((l) => (l.links ?? 0) === wantLinks) ?? same.find((l) => !l.links) ?? same[0];
}

export function pickGem(lines: StashLine[], item: ParsedItem): StashLine | null {
  const lvl = item.gemLevel ?? 1;
  const q = item.quality;
  const cands = lines.filter((l) => l.name === item.name && !!l.corrupted === item.corrupted);
  const exact = cands.find((l) => l.gemLevel === lvl && (l.gemQuality ?? 0) === q);
  if (exact) return exact;
  // closest variant that the item is at least as good as
  const below = cands
    .filter((l) => (l.gemLevel ?? 1) <= lvl && (l.gemQuality ?? 0) <= q)
    .sort((a, b) => (b.gemLevel ?? 1) - (a.gemLevel ?? 1) || (b.gemQuality ?? 0) - (a.gemQuality ?? 0));
  return below[0] ?? null;
}
