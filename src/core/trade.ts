// Official trade API (www.pathofexile.com/api/trade): search + fetch, each behind its own
// rate limiter fed by the X-Rate-Limit-* headers GGG sends back.
import type { PriceFilters, PriceRange } from "../shared/types";
import type { ParsedItem } from "./item";
import type { Defences, WeaponDps } from "./itemCalc";
import { RateLimiter } from "./ratelimit";
import type { MatchedMod } from "./stats";

const SITE = "https://www.pathofexile.com";
export const kFetchBatch = 10;

export interface TradeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}
export type TradeFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<TradeResponse>;

export interface StatFilter extends MatchedMod {
  enabled: boolean;
  min: number | null;
  max?: number | null;
}

export interface TradeListing {
  amount: number;
  currency: string;
  indexed: string;
}

export interface TradeSearchResult {
  id: string;
  total: number;
  url: string;
  listings: TradeListing[];
}

const CATEGORY_BY_CLASS: Record<string, string> = {
  "Body Armours": "armour.chest",
  Boots: "armour.boots",
  Gloves: "armour.gloves",
  Helmets: "armour.helmet",
  Shields: "armour.shield",
  Quivers: "armour.quiver",
  Amulets: "accessory.amulet",
  Rings: "accessory.ring",
  Belts: "accessory.belt",
  Trinkets: "accessory.trinket",
  Jewels: "jewel.base",
  "Abyss Jewels": "jewel.abyss",
  Bows: "weapon.bow",
  Claws: "weapon.claw",
  Daggers: "weapon.basedagger",
  "Rune Daggers": "weapon.runedagger",
  "One Hand Axes": "weapon.oneaxe",
  "One Hand Maces": "weapon.basemace",
  "One Hand Swords": "weapon.basesword",
  "Thrusting One Hand Swords": "weapon.rapier",
  Sceptres: "weapon.sceptre",
  Staves: "weapon.basestaff",
  Warstaves: "weapon.warstaff",
  "Two Hand Axes": "weapon.twoaxe",
  "Two Hand Maces": "weapon.twomace",
  "Two Hand Swords": "weapon.twosword",
  Wands: "weapon.wand",
  "Fishing Rods": "weapon.rod",
  Maps: "map",
  Tinctures: "tincture",
};

export function tradeCategory(itemClass: string): string | null {
  if (/Flasks$/.test(itemClass)) return "flask";
  return CATEGORY_BY_CLASS[itemClass] ?? null;
}

/** Weapons and armour have local versions of some stats ("Adds # to # Physical Damage (Local)"). */
export function hasLocalMods(itemClass: string): boolean {
  const c = tradeCategory(itemClass);
  return !!c && (c.startsWith("weapon") || c.startsWith("armour"));
}

/** Default "min" for a mod filter: a bit below the rolled value, so near-identical items match. */
export function defaultMin(value: number | null, tolerance = 0.1): number | null {
  if (value === null) return null;
  if (value < 0) return null; // negative stats: no lower bound
  const m = value * (1 - tolerance);
  return value >= 10 ? Math.floor(m) : Math.floor(m * 10) / 10;
}

const range = (min: number | null, max: number | null) => ({ ...(min !== null ? { min } : {}), ...(max !== null ? { max } : {}) });

/** "90% of what the item has", rounded the way people type it. */
const near = (v: number | null): number | null => (v === null || v <= 0 ? null : v >= 10 ? Math.floor(v * 0.9) : Math.floor(v * 9) / 10);

const INFLUENCE_FILTER: Record<string, string> = {
  Shaper: "shaper_item",
  Elder: "elder_item",
  Crusader: "crusader_item",
  Redeemer: "redeemer_item",
  Hunter: "hunter_item",
  Warlord: "warlord_item",
};

/**
 * The filters a search starts with, close to Awakened PoE Trade's: what makes the item what it is
 * (gem level, map tier, links, unique corruption) on; rares by category, weapons by DPS and armour
 * by its defence when they are rare/magic.
 */
export function defaultFilters(item: ParsedItem, dps: WeaponDps | null, def: Defences | null): PriceFilters {
  const rareish = item.rarity === "Rare" || item.rarity === "Magic";
  const gem = /Gem/.test(item.rarity);
  const r = (enabled: boolean, min: number | null, max: number | null = null): PriceRange => ({ enabled, min, max });
  const f: PriceFilters = {
    online: true,
    baseType: false,
    itemLevel: item.itemLevel !== null && !gem ? r(item.rarity === "Normal" && item.itemLevel >= 82, item.itemLevel) : null,
    quality: item.quality > 0 ? r(gem, item.quality) : gem ? r(false, null) : null,
    links: item.sockets ? r(item.links >= 5, item.links >= 5 ? item.links : null) : null,
    gemLevel: gem ? r(true, item.gemLevel ?? 1) : null,
    mapTier: item.mapTier !== null ? r(true, item.mapTier, item.mapTier) : null,
    corrupted: item.rarity === "Unique" || gem ? (item.corrupted ? "yes" : "no") : "any",
    influences: item.influences.filter((i) => INFLUENCE_FILTER[i]).map((name) => ({ name, enabled: true })),
    pdps: null,
    edps: null,
    dps: null,
    armour: null,
    evasion: null,
    es: null,
    ward: null,
  };
  if (dps && rareish) {
    f.pdps = r(dps.pdps > 0 && dps.pdps >= dps.edps, near(dps.pdps));
    f.edps = r(dps.edps > dps.pdps, near(dps.edps));
    f.dps = r(false, near(dps.dps));
  }
  if (def && rareish) {
    if (def.armour) f.armour = r(true, near(def.armour));
    if (def.evasion) f.evasion = r(true, near(def.evasion));
    if (def.es) f.es = r(true, near(def.es));
    if (def.ward) f.ward = r(true, near(def.ward));
  }
  return f;
}

/** Local damage/defence lines a DPS or defence filter already accounts for (their own filters start off). */
export function coveredByCalc(text: string, f: PriceFilters): boolean {
  const dpsOn = !!(f.pdps?.enabled || f.edps?.enabled || f.dps?.enabled);
  if (dpsOn && /^Adds \d+ to \d+ (Physical|Fire|Cold|Lightning|Chaos) Damage$|^\d+% increased (Physical Damage|Attack Speed)$/.test(text)) {
    return true;
  }
  const defOn = !!(f.armour?.enabled || f.evasion?.enabled || f.es?.enabled || f.ward?.enabled);
  return defOn && /^\+\d+ to (Armour|Evasion Rating|maximum Energy Shield|Ward)$|^\d+% increased (Armour|Evasion|Energy Shield)/.test(text);
}

export function buildQuery(item: ParsedItem, stats: StatFilter[], f: PriceFilters): object {
  const filters: Record<string, { filters: Record<string, unknown> }> = {};
  const add = (group: string, key: string, v: unknown) => {
    (filters[group] ??= { filters: {} }).filters[key] = v;
  };
  const addRange = (group: string, key: string, r: PriceRange | null) => {
    if (r?.enabled && (r.min !== null || r.max !== null)) add(group, key, range(r.min, r.max));
  };
  const query: Record<string, unknown> = { status: { option: f.online ? "online" : "any" } };

  if (item.rarity === "Unique" && item.name) {
    query.name = item.name;
    query.type = item.baseType;
  } else if (/Gem/.test(item.rarity)) {
    query.type = item.baseType;
  } else if (item.rarity === "Rare" || item.rarity === "Magic") {
    const cat = tradeCategory(item.itemClass);
    if (cat && !f.baseType) add("type_filters", "category", { option: cat });
    else query.type = item.baseType;
    add("type_filters", "rarity", { option: "nonunique" });
  } else {
    query.type = item.baseType;
  }
  addRange("misc_filters", "ilvl", f.itemLevel);
  addRange("misc_filters", "quality", f.quality);
  addRange("misc_filters", "gem_level", f.gemLevel);
  addRange("map_filters", "map_tier", f.mapTier);
  addRange("socket_filters", "links", f.links);
  if (f.corrupted !== "any") add("misc_filters", "corrupted", { option: f.corrupted === "yes" ? "true" : "false" });
  for (const i of f.influences) if (i.enabled && INFLUENCE_FILTER[i.name]) add("misc_filters", INFLUENCE_FILTER[i.name], { option: "true" });
  addRange("weapon_filters", "pdps", f.pdps);
  addRange("weapon_filters", "edps", f.edps);
  addRange("weapon_filters", "dps", f.dps);
  addRange("armour_filters", "ar", f.armour);
  addRange("armour_filters", "ev", f.evasion);
  addRange("armour_filters", "es", f.es);
  addRange("armour_filters", "ward", f.ward);

  const statFilters = stats
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.statId, value: range(s.min, s.max ?? null), disabled: false }));
  query.stats = [{ type: "and", filters: statFilters }];
  if (Object.keys(filters).length) query.filters = filters;
  return { query, sort: { price: "asc" } };
}

export class TradeClient {
  private readonly searchLimiter = new RateLimiter();
  private readonly fetchLimiter = new RateLimiter();

  constructor(
    private readonly fetchFn: TradeFetch,
    private readonly userAgent: string,
  ) {}

  private async call(limiter: RateLimiter, url: string, init: { method?: string; body?: string } = {}) {
    await limiter.acquire();
    const res = await this.fetchFn(url, {
      ...init,
      headers: { "User-Agent": this.userAgent, "Content-Type": "application/json", Accept: "application/json" },
    });
    // every scope GGG reports (Ip, Account...) counts: merge them into one rule set
    const scopes = (res.headers.get("x-rate-limit-rules") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const join = (suffix: string) =>
      scopes
        .map((s) => res.headers.get(`x-rate-limit-${s}${suffix}`))
        .filter(Boolean)
        .join(",");
    limiter.update({ rules: join(""), state: join("-state"), retryAfter: res.headers.get("retry-after") });
    if (res.status === 429) throw new Error("limite de requisições do trade atingido, tente de novo em instantes");
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body.error?.message) msg += `: ${body.error.message}`;
      } catch {
        /* no body */
      }
      throw new Error(`trade: ${msg}`);
    }
    return res.json();
  }

  searchUrl(league: string, id: string): string {
    return `${SITE}/trade/search/${encodeURIComponent(league)}/${id}`;
  }

  /** Registers a search and returns its id + result count, without fetching listings. */
  async searchId(league: string, query: object): Promise<{ id: string; total: number; url: string }> {
    const s = (await this.call(this.searchLimiter, `${SITE}/api/trade/search/${encodeURIComponent(league)}`, {
      method: "POST",
      body: JSON.stringify(query),
    })) as { id: string; total: number };
    return { id: s.id, total: s.total, url: this.searchUrl(league, s.id) };
  }

  async search(league: string, query: object): Promise<TradeSearchResult> {
    const s = (await this.call(this.searchLimiter, `${SITE}/api/trade/search/${encodeURIComponent(league)}`, {
      method: "POST",
      body: JSON.stringify(query),
    })) as { id: string; total: number; result: string[] };
    const ids = s.result.slice(0, kFetchBatch);
    let listings: TradeListing[] = [];
    if (ids.length) {
      const f = (await this.call(
        this.fetchLimiter,
        `${SITE}/api/trade/fetch/${ids.join(",")}?query=${encodeURIComponent(s.id)}`,
      )) as { result: ({ listing?: { indexed?: string; price?: { amount?: number; currency?: string } } } | null)[] };
      listings = f.result
        .map((r) => r?.listing)
        .filter((l): l is NonNullable<typeof l> => !!l?.price?.amount && !!l.price.currency)
        .map((l) => ({ amount: l.price!.amount!, currency: l.price!.currency!, indexed: l.indexed ?? "" }));
    }
    return { id: s.id, total: s.total, url: this.searchUrl(league, s.id), listings };
  }
}

export async function fetchLeagues(fetchFn: TradeFetch, userAgent: string): Promise<string[]> {
  const res = await fetchFn(`${SITE}/api/trade/data/leagues`, { headers: { "User-Agent": userAgent } });
  if (!res.ok) throw new Error(`leagues HTTP ${res.status}`);
  const j = (await res.json()) as { result: { id: string; realm?: string }[] };
  return j.result.filter((l) => !l.realm || l.realm === "pc").map((l) => l.id);
}

/** First pc league that is not a permanent one: the current challenge league. */
export function defaultLeague(leagues: string[]): string | null {
  const permanent = /^(Standard|Hardcore|Ruthless|Hardcore Ruthless)$/;
  return leagues.find((l) => !permanent.test(l) && !/Hardcore|Ruthless|HC|SSF/.test(l)) ?? leagues[0] ?? null;
}

export async function fetchStats(fetchFn: TradeFetch, userAgent: string): Promise<unknown> {
  const res = await fetchFn(`${SITE}/api/trade/data/stats`, { headers: { "User-Agent": userAgent } });
  if (!res.ok) throw new Error(`stats HTTP ${res.status}`);
  return res.json();
}
