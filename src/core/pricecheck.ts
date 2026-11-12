// Price check orchestration: clipboard text -> parsed item -> poe.ninja estimate + trade listings.
// No Electron here; main.ts wires the clipboard and broadcasts the view.
import { parseItem, type ParsedItem } from "./item";
import { defences, pseudoStats, weaponDps } from "./itemCalc";
import { compareItem, type EquippedItem } from "./itemCompare";
import type { NinjaClient } from "./ninja";
import type { StatIndex } from "./stats";
import {
  buildQuery,
  coveredByCalc,
  defaultFilters,
  defaultMin,
  hasLocalMods,
  kFetchBatch,
  type StaticIds,
  type StatFilter,
  type TradeClient,
  type TradeListing,
} from "./trade";
import type { PriceListing, PriceModFilter, PriceSearchPatch, PriceView } from "../shared/types";

/** Totals searched by default (Awakened PoE Trade does the same); the others are offered, off. */
const PSEUDO_ON = new Set([
  "pseudo.pseudo_total_elemental_resistance",
  "pseudo.pseudo_total_life",
  "pseudo.pseudo_total_energy_shield",
  "pseudo.pseudo_increased_movement_speed",
]);

const NO_TRADE_CLASSES = /^(Stackable Currency|Divination Cards|Map Fragments|Delve Stackable Socketable Currency)$/;
const NO_TRADE_RARITY = /^(Currency|Divination Card)$/;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface PriceCheckDeps {
  ninja: NinjaClient;
  trade: TradeClient;
  stats: () => Promise<StatIndex | null>;
  /** bulk exchange ids (item name -> "divine"...); optional */
  staticIds?: () => Promise<StaticIds | null>;
  onUpdate: (v: PriceView) => void;
  now?: () => number;
  /** what the imported PoB build wears ("compare with my item"); empty / absent = no build */
  equipped?: () => readonly EquippedItem[];
}

/** Fewer trade results than this: also search "similar items" (minimums 20% lower). */
const kFewResults = 3;
const kSimilarFactor = 0.8;

/** On a weapon searched by DPS, only these lines start on (resistances, life... say little about its price). */
const ATTACK_MOD = /Critical Strike|Damage|Attack|Accuracy|Socketed|Gems?\b|Leech|Projectile|Area of Effect/;

/** Bulk offers shown. */
const kBulkOffers = 12;

/** The same item copied again within this time reuses the last search. */
const kSameItemMs = 10_000;

export class PriceChecker {
  private seq = 0;
  private current: { item: ParsedItem; view: PriceView; text: string; queryId: string | null; rest: string[] } | null = null;

  constructor(private readonly d: PriceCheckDeps) {}

  get view(): PriceView | null {
    return this.current?.view ?? null;
  }

  /** Returns false when the text is not an item. */
  check(text: string, league: string): boolean {
    const item = parseItem(text);
    if (!item) return false;
    // the same item again while its search runs (or a few seconds after): show that one, don't spend the trade limit twice
    const cur = this.current;
    if (cur && cur.text === text && cur.view.league === league) {
      const v = cur.view;
      const loading = v.ninjaStatus === "loading" || v.tradeStatus === "loading" || v.bulkStatus === "loading";
      const failed = v.ninjaStatus === "error" || v.tradeError !== null || v.bulkStatus === "error";
      if (loading || (!failed && (this.d.now ?? Date.now)() - v.at < kSameItemMs)) {
        this.emit();
        return true;
      }
    }
    const seq = ++this.seq;
    const dps = weaponDps(item);
    const def = defences(item);
    const view: PriceView = {
      seq,
      at: (this.d.now ?? Date.now)(),
      league,
      item: {
        name: item.name,
        baseType: item.baseType,
        rarity: item.rarity,
        itemClass: item.itemClass,
        itemLevel: item.itemLevel,
        gemLevel: item.gemLevel,
        quality: item.quality,
        links: item.links,
        corrupted: item.corrupted,
        stackSize: item.stackSize,
        mods: item.mods.map((m) => ({ ...m })),
        affixes: item.affixes,
      },
      ninjaStatus: "loading",
      ninjaError: null,
      ninja: null,
      tradeStatus: NO_TRADE_RARITY.test(item.rarity) || NO_TRADE_CLASSES.test(item.itemClass) ? "n/a" : "loading",
      tradeError: null,
      trade: null,
      mods: [],
      unmatched: [],
      chaosPerDivine: null,
      filters: defaultFilters(item, dps, def),
      calc: { dps, def },
      bulkStatus: this.d.staticIds && (item.stackSize !== null || NO_TRADE_CLASSES.test(item.itemClass)) ? "loading" : "n/a",
      bulkError: null,
      bulk: null,
      compare: null,
      similar: null,
    };
    const equipped = this.d.equipped?.() ?? [];
    if (equipped.length) {
      const cmp = compareItem(item, equipped);
      view.compare = cmp.length ? cmp : null;
    }
    this.current = { item, view, text, queryId: null, rest: [] };
    this.emit();
    void this.runNinja(seq, league, item);
    if (view.tradeStatus === "loading") void this.prepareMods(seq, item).then(() => this.runTrade(seq, league));
    if (view.bulkStatus === "loading") void this.runBulk(seq, league, item);
    return true;
  }

  /** Bulk exchange: real offers for currency, fragments, cards... paid in chaos or divines. */
  private async runBulk(seq: number, league: string, item: ParsedItem): Promise<void> {
    try {
      const ids = await this.d.staticIds?.();
      const want = ids?.get(item.baseType) ?? ids?.get(item.name);
      if (!want) return void this.patch(seq, { bulkStatus: "n/a" });
      const have = want === "divine" ? ["chaos"] : want === "chaos" ? ["divine"] : ["chaos", "divine"];
      const [res, rates] = await Promise.all([
        this.d.trade.exchange(league, want, have, this.current?.view.filters.status ?? "securable"),
        this.d.ninja.currencyRates(league).catch(() => null),
      ]);
      const rate = (c: string) => (c === "chaos" ? 1 : rates?.get(c));
      const offers = res.offers
        .map((o) => {
          const r = rate(o.pay.currency);
          return { ...o, chaosPerUnit: r !== undefined ? Math.round(((o.pay.amount * r) / o.get.amount) * 100) / 100 : null };
        })
        .sort((a, b) => (a.chaosPerUnit ?? Infinity) - (b.chaosPerUnit ?? Infinity))
        .slice(0, kBulkOffers)
        .map(({ chaosPerUnit, pay, get, seller, character, status }) => ({ chaosPerUnit, pay, get, seller, character, status }));
      this.patch(seq, { bulkStatus: "done", bulk: { total: res.total, url: res.url, offers } });
    } catch (e) {
      this.patch(seq, { bulkStatus: "error", bulkError: (e as Error).message });
    }
  }

  /** The next 10 listings of the current search. */
  async more(): Promise<void> {
    const cur = this.current;
    if (!cur?.queryId || !cur.rest.length || !cur.view.trade) return;
    const seq = cur.view.seq;
    const ids = cur.rest.slice(0, kFetchBatch);
    try {
      const [listings, rates] = await Promise.all([
        this.d.trade.fetchListings(cur.queryId, ids),
        this.d.ninja.currencyRates(cur.view.league).catch(() => null),
      ]);
      if (this.current !== cur) return;
      cur.rest = cur.rest.slice(ids.length);
      const trade = cur.view.trade!;
      const all = [...trade.listings, ...withChaos(listings, rates)];
      this.patch(seq, { trade: { ...trade, listings: all, more: cur.rest.length } });
    } catch (e) {
      this.patch(seq, { tradeError: (e as Error).message });
    }
  }

  /** Re-run the trade search with the player's choices (popup / panel): mods and filters. */
  research(patch: PriceSearchPatch): void {
    const cur = this.current;
    if (!cur || cur.view.tradeStatus === "n/a") return;
    const byId = new Map(patch.mods.map((p) => [p.statId, p]));
    const mods = cur.view.mods.map((m) => {
      const p = byId.get(m.statId);
      return p ? { ...m, enabled: p.enabled, min: p.min, max: p.max } : m;
    });
    this.patch(cur.view.seq, { mods, filters: patch.filters, tradeStatus: "loading", tradeError: null, similar: null });
    void this.runTrade(cur.view.seq, cur.view.league);
  }

  private emit(): void {
    if (this.current) this.d.onUpdate(this.current.view);
  }

  private patch(seq: number, p: Partial<PriceView>): boolean {
    if (!this.current || this.current.view.seq !== seq) return false; // a newer item replaced it
    this.current.view = { ...this.current.view, ...p };
    this.emit();
    return true;
  }

  private async runNinja(seq: number, league: string, item: ParsedItem): Promise<void> {
    try {
      const rates = await this.d.ninja.currencyRates(league).catch(() => null);
      const price = await this.d.ninja.price(league, item);
      this.patch(seq, {
        ninja: price,
        ninjaStatus: price ? "done" : "n/a",
        chaosPerDivine: rates?.get("divine") ?? null,
      });
    } catch (e) {
      this.patch(seq, { ninjaStatus: "error", ninjaError: (e as Error).message });
    }
  }

  private async prepareMods(seq: number, item: ParsedItem): Promise<void> {
    const rareish = item.rarity === "Rare" || item.rarity === "Magic";
    // uniques are searched by name; their rolls can be added by hand (all mods start off)
    if (!rareish && item.rarity !== "Unique") return;
    if (item.unidentified) return;
    const index = await this.d.stats().catch(() => null);
    if (!index) return;
    const filters = this.current?.view.seq === seq ? this.current.view.filters : null;
    const local = hasLocalMods(item.itemClass);
    const mods: PriceModFilter[] = [];
    const unmatched: string[] = [];
    const seen = new Set<string>();
    // totals the trade site computes (resistances, life...) replace the lines they add up
    const pseudo = rareish ? pseudoStats(item) : [];
    const folded = new Set<string>();
    // a weapon searched by DPS is priced by its damage: totals (resistances...) start off
    const byDps = !!(filters?.pdps?.enabled || filters?.edps?.enabled || filters?.dps?.enabled);
    for (const p of pseudo) {
      const on = PSEUDO_ON.has(p.statId) && !byDps;
      if (on) for (const line of p.from) folded.add(line);
      mods.push({ text: p.text, kind: "pseudo", statId: p.statId, value: p.value, min: defaultMin(p.value), max: null, enabled: on });
    }
    for (const m of item.mods) {
      const hit = index.match(m, local);
      if (!hit) {
        unmatched.push(m.text);
        continue;
      }
      if (seen.has(hit.statId)) continue;
      seen.add(hit.statId);
      // explicit/fractured carry the value; implicits and crafted mods are opt-in; what a total,
      // the DPS or the defence filter already counts starts off
      const enabled =
        rareish &&
        (hit.kind === "explicit" || hit.kind === "fractured") &&
        !folded.has(m.text) &&
        !(filters && coveredByCalc(m.text, filters)) &&
        (!byDps || ATTACK_MOD.test(m.text));
      mods.push({ ...hit, min: defaultMin(hit.value), max: null, enabled });
    }
    this.patch(seq, { mods, unmatched });
  }

  private async runTrade(seq: number, league: string): Promise<void> {
    const cur = this.current;
    if (!cur || cur.view.seq !== seq) return;
    let item = cur.item;
    if ((item.rarity === "Rare" || item.rarity === "Magic") && item.unidentified) {
      item = { ...item, rarity: "Normal" }; // search by base type
    }
    try {
      const query = buildQuery(item, cur.view.mods as StatFilter[], cur.view.filters);
      const res = await this.d.trade.search(league, query);
      const rates = await this.d.ninja.currencyRates(league).catch(() => null);
      const listings = withChaos(res.listings, rates);
      const chaos = listings.map((l) => l.chaos).filter((c): c is number => c !== null);
      if (this.current === cur) {
        cur.queryId = res.id;
        cur.rest = res.rest;
      }
      this.patch(seq, {
        tradeStatus: "done",
        trade: { total: res.total, url: res.url, listings, medianChaos: median(chaos), more: res.rest.length },
      });
      if (res.total < kFewResults) await this.runSimilar(seq, league, item, rates);
    } catch (e) {
      this.patch(seq, { tradeStatus: "error", tradeError: (e as Error).message });
    }
  }

  /** Few results: the same search with every enabled minimum 20% lower, to still show a price idea. */
  private async runSimilar(seq: number, league: string, item: ParsedItem, rates: Map<string, number> | null): Promise<void> {
    const cur = this.current;
    if (!cur || cur.view.seq !== seq) return;
    const lower = (v: number | null) => (v === null ? null : v > 0 ? Math.floor(v * kSimilarFactor) : v);
    const mods = cur.view.mods.map((m) => (m.enabled && m.min !== null ? { ...m, min: lower(m.min) } : m));
    const f = cur.view.filters;
    const lowerRange = <T extends { enabled: boolean; min: number | null } | null>(r: T): T => (r?.enabled ? { ...r, min: lower(r.min) } : r);
    const filters = { ...f, pdps: lowerRange(f.pdps), edps: lowerRange(f.edps), dps: lowerRange(f.dps), armour: lowerRange(f.armour), evasion: lowerRange(f.evasion), es: lowerRange(f.es) };
    const changed = mods.some((m, i) => m.min !== cur.view.mods[i].min) || JSON.stringify(filters) !== JSON.stringify(f);
    if (!changed) return;
    try {
      const res = await this.d.trade.search(league, buildQuery(item, mods as StatFilter[], filters));
      const listings = withChaos(res.listings, rates).slice(0, 5);
      const chaos = listings.map((l) => l.chaos).filter((c): c is number => c !== null);
      this.patch(seq, { similar: { total: res.total, url: res.url, listings, medianChaos: median(chaos) } });
    } catch {
      /* the main search already answered; similar items are a bonus */
    }
  }
}

function withChaos(listings: TradeListing[], rates: Map<string, number> | null): PriceListing[] {
  return listings.map((l) => {
    const rate = l.currency === "chaos" ? 1 : rates?.get(l.currency);
    // below 1 chaos keep two significant digits: 1 alch in Standard is 0.0006 c, not 0
    const c = rate !== undefined ? l.amount * rate : null;
    return { ...l, chaos: c === null ? null : c < 1 ? Number(c.toPrecision(2)) : Math.round(c * 10) / 10 };
  });
}
