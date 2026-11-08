// Price check orchestration: clipboard text -> parsed item -> poe.ninja estimate + trade listings.
// No Electron here; main.ts wires the clipboard and broadcasts the view.
import { parseItem, type ParsedItem } from "./item";
import type { NinjaClient } from "./ninja";
import type { StatIndex } from "./stats";
import { buildQuery, defaultMin, hasLocalMods, type StatFilter, type TradeClient } from "./trade";
import type { PriceModFilter, PriceView } from "../shared/types";

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
  onUpdate: (v: PriceView) => void;
  now?: () => number;
}

export class PriceChecker {
  private seq = 0;
  private current: { item: ParsedItem; view: PriceView } | null = null;

  constructor(private readonly d: PriceCheckDeps) {}

  get view(): PriceView | null {
    return this.current?.view ?? null;
  }

  /** Returns false when the text is not an item. */
  check(text: string, league: string): boolean {
    const item = parseItem(text);
    if (!item) return false;
    const seq = ++this.seq;
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
    };
    this.current = { item, view };
    this.emit();
    void this.runNinja(seq, league, item);
    if (view.tradeStatus === "loading") void this.prepareMods(seq, item).then(() => this.runTrade(seq, league));
    return true;
  }

  /** Re-run the trade search with the user's mod choices (dashboard). */
  research(patch: { statId: string; enabled: boolean; min: number | null }[]): void {
    const cur = this.current;
    if (!cur || cur.view.tradeStatus === "n/a") return;
    const byId = new Map(patch.map((p) => [p.statId, p]));
    const mods = cur.view.mods.map((m) => {
      const p = byId.get(m.statId);
      return p ? { ...m, enabled: p.enabled, min: p.min } : m;
    });
    this.patch(cur.view.seq, { mods, tradeStatus: "loading", tradeError: null });
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
    if (item.rarity !== "Rare" && item.rarity !== "Magic") return;
    if (item.unidentified) return;
    const index = await this.d.stats().catch(() => null);
    if (!index) return;
    const local = hasLocalMods(item.itemClass);
    const mods: PriceModFilter[] = [];
    const unmatched: string[] = [];
    const seen = new Set<string>();
    for (const m of item.mods) {
      const hit = index.match(m, local);
      if (!hit) {
        unmatched.push(m.text);
        continue;
      }
      if (seen.has(hit.statId)) continue;
      seen.add(hit.statId);
      // explicit/fractured carry the value; implicits and crafted mods are opt-in
      const enabled = hit.kind === "explicit" || hit.kind === "fractured";
      mods.push({ ...hit, min: defaultMin(hit.value), enabled });
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
      const query = buildQuery(item, cur.view.mods as StatFilter[]);
      const res = await this.d.trade.search(league, query);
      const rates = await this.d.ninja.currencyRates(league).catch(() => null);
      const listings = res.listings.map((l) => {
        const rate = rates?.get(l.currency);
        return { ...l, chaos: rate !== undefined ? Math.round(l.amount * rate * 10) / 10 : null };
      });
      const chaos = listings.map((l) => l.chaos).filter((c): c is number => c !== null);
      this.patch(seq, {
        tradeStatus: "done",
        trade: { total: res.total, url: res.url, listings, medianChaos: median(chaos) },
      });
    } catch (e) {
      this.patch(seq, { tradeStatus: "error", tradeError: (e as Error).message });
    }
  }
}
