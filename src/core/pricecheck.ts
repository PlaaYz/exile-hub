// Price check orchestration: item text -> parsed item -> poe.ninja price, comparison with what is worn.
import { parseItem, type ParsedItem } from "./item";
import { defences, weaponDps } from "./itemCalc";
import { compareItem, type EquippedItem } from "./itemCompare";
import type { NinjaClient } from "./ninja";
import type { PriceView } from "../shared/types";

export interface PriceCheckDeps {
  ninja: NinjaClient;
  onUpdate: (v: PriceView) => void;
  now?: () => number;
  /** what the player wears ("compare with my item"); empty / absent = nothing registered */
  equipped?: () => readonly EquippedItem[];
}

export class PriceChecker {
  private seq = 0;
  view: PriceView | null = null;

  constructor(private readonly d: PriceCheckDeps) {}

  /** Returns false when the text is not an item. */
  check(text: string, league: string): boolean {
    const item = parseItem(text);
    if (!item) return false;
    const seq = ++this.seq;
    const compare = compareItem(item, this.d.equipped?.() ?? []);
    this.view = {
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
      chaosPerDivine: null,
      calc: { dps: weaponDps(item), def: defences(item) },
      compare: compare.length ? compare : null,
    };
    this.d.onUpdate(this.view);
    void this.runNinja(seq, league, item);
    return true;
  }

  private patch(seq: number, p: Partial<PriceView>): void {
    if (this.view?.seq !== seq) return; // a newer item replaced it
    this.view = { ...this.view, ...p };
    this.d.onUpdate(this.view);
  }

  private async runNinja(seq: number, league: string, item: ParsedItem): Promise<void> {
    try {
      const rates = await this.d.ninja.currencyRates(league).catch(() => null);
      const price = await this.d.ninja.price(league, item);
      this.patch(seq, { ninja: price, ninjaStatus: price ? "done" : "n/a", chaosPerDivine: rates?.get("divine") ?? null });
    } catch (e) {
      this.patch(seq, { ninjaStatus: "error", ninjaError: (e as Error).message });
    }
  }
}
