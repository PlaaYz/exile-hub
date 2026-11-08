// Official trade API (www.pathofexile.com/api/trade): search + fetch, each behind its own
// rate limiter fed by the X-Rate-Limit-* headers GGG sends back.
import type { ParsedItem } from "./item";
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

export function buildQuery(item: ParsedItem, stats: StatFilter[]): object {
  const filters: Record<string, { filters: Record<string, unknown> }> = {};
  const add = (group: string, key: string, v: unknown) => {
    (filters[group] ??= { filters: {} }).filters[key] = v;
  };
  const query: Record<string, unknown> = { status: { option: "online" } };

  if (item.rarity === "Unique" && item.name) {
    query.name = item.name;
    query.type = item.baseType;
  } else if (/Gem/.test(item.rarity)) {
    query.type = item.baseType;
    add("misc_filters", "gem_level", { min: item.gemLevel ?? 1 });
    if (item.quality) add("misc_filters", "quality", { min: item.quality });
  } else if (item.rarity === "Rare" || item.rarity === "Magic") {
    const cat = tradeCategory(item.itemClass);
    if (cat) add("type_filters", "category", { option: cat });
    else query.type = item.baseType;
    add("type_filters", "rarity", { option: "nonunique" });
  } else {
    query.type = item.baseType;
  }
  if (item.mapTier !== null) add("map_filters", "map_tier", { min: item.mapTier, max: item.mapTier });
  if (item.links >= 5) add("socket_filters", "links", { min: item.links });
  if (item.rarity === "Unique" || /Gem/.test(item.rarity)) {
    add("misc_filters", "corrupted", { option: item.corrupted ? "true" : "false" });
  }

  const statFilters = stats
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.statId, value: s.min === null ? {} : { min: s.min }, disabled: false }));
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
