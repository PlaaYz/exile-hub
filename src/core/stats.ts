// Maps item mod lines to trade API stat ids, using /api/trade/data/stats.
import type { ItemMod, ModKind } from "./item";

export interface TradeStatsData {
  result: { id: string; entries: { id: string; text: string; type: string; option?: unknown }[] }[];
}

export interface MatchedMod {
  text: string;
  kind: ModKind;
  statId: string;
  /** value used for "min" (average for "Adds # to #"); null when the stat has no number */
  value: number | null;
}

const NUM = /[+-]?\d+(?:\.\d+)?/g;

/** "+38% to Cold Resistance" -> "+#% to Cold Resistance" (sign kept as in the trade texts). */
export function template(line: string): { key: string; values: number[] } {
  const values: number[] = [];
  const key = line.replace(NUM, (m) => {
    values.push(Number(m));
    return m.startsWith("+") ? "+#" : m.startsWith("-") ? "-#" : "#";
  });
  return { key, values };
}

export class StatIndex {
  /** type -> template -> stat id */
  private byType = new Map<string, Map<string, string>>();

  /** the trade site's stat list as loaded (map mod lookups reuse it) */
  readonly raw: TradeStatsData;

  constructor(data: TradeStatsData) {
    this.raw = data;
    for (const group of data.result) {
      for (const e of group.entries) {
        if (e.option) continue; // option stats (e.g. "Allocates #") need an option id, not a number
        let m = this.byType.get(e.type);
        if (!m) this.byType.set(e.type, (m = new Map()));
        if (!m.has(e.text)) m.set(e.text, e.id);
      }
    }
  }

  get size(): number {
    let n = 0;
    for (const m of this.byType.values()) n += m.size;
    return n;
  }

  match(mod: ItemMod, preferLocal: boolean): MatchedMod | null {
    const types = this.byType.get(mod.kind);
    if (!types) return null;
    const { key, values } = template(mod.text);
    const tries: { key: string; sign: number }[] = [];
    const add = (k: string, sign = 1) => {
      if (preferLocal) tries.push({ key: `${k} (Local)`, sign });
      tries.push({ key: k, sign });
    };
    add(key);
    // trade texts often only have the "+#" form, the "increased" form, or no sign at all
    add(key.replace(/^\+#/, "#"));
    if (/^-#/.test(key)) add(key.replace(/^-#/, "+#"));
    if (/\breduced\b/.test(key)) add(key.replace(/\breduced\b/, "increased"), -1);
    if (/\bless\b/.test(key)) add(key.replace(/\bless\b/, "more"), -1);
    for (const t of tries) {
      const id = types.get(t.key);
      if (!id) continue;
      const v = values.length ? (values.reduce((a, b) => a + b, 0) / values.length) * t.sign : null;
      return { text: mod.text, kind: mod.kind, statId: id, value: v === null ? null : Math.round(v * 100) / 100 };
    }
    return null;
  }
}
