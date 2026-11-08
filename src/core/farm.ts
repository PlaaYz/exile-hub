// Expected value of a boss run: sum(drops per kill x price) - entry cost.
import type { FarmBoss, FarmItem } from "../shared/farmData";

export interface FarmPrice {
  chaos: number;
  lowConfidence?: boolean;
  variants?: number;
}

/** User edits for one boss: drop amounts (per 100 kills), manual prices (chaos), minutes per run. */
export interface FarmOverrides {
  amounts?: Record<string, number>;
  prices?: Record<string, number>;
  minutesPerRun?: number | null;
}

export interface FarmLine {
  name: string;
  /** per 100 kills for drops, quantity for entry items */
  amount: number;
  amountEdited: boolean;
  price: number | null;
  priceManual: boolean;
  lowConfidence: boolean;
  /** chaos this line adds to (drops) or costs (entry) one run */
  value: number | null;
}

export interface FarmResult {
  drops: FarmLine[];
  entry: FarmLine[];
  dropsValue: number;
  entryCost: number;
  profit: number;
  /** items with no price (neither poe.ninja nor manual): they count as 0 */
  missing: string[];
  profitPerHour: number | null;
}

function line(item: FarmItem, perKill: number, prices: Map<string, FarmPrice>, ov: FarmOverrides, isDrop: boolean): FarmLine {
  const edited = isDrop && ov.amounts?.[item.name] !== undefined;
  const amount = edited ? ov.amounts![item.name] : item.amount;
  const manual = ov.prices?.[item.name];
  const live = prices.get(item.name);
  const price = manual ?? live?.chaos ?? null;
  return {
    name: item.name,
    amount,
    amountEdited: edited,
    price,
    priceManual: manual !== undefined,
    lowConfidence: manual === undefined && !!live?.lowConfidence,
    value: price === null ? null : amount * perKill * price,
  };
}

export function farmEv(boss: FarmBoss, prices: Map<string, FarmPrice>, ov: FarmOverrides = {}): FarmResult {
  const drops = boss.drops.map((d) => line(d, 1 / 100, prices, ov, true));
  const entry = boss.entry.map((e) => line(e, 1, prices, ov, false));
  const sum = (ls: FarmLine[]) => ls.reduce((a, l) => a + (l.value ?? 0), 0);
  const dropsValue = sum(drops);
  const entryCost = sum(entry);
  const profit = dropsValue - entryCost;
  const min = ov.minutesPerRun;
  return {
    drops,
    entry,
    dropsValue,
    entryCost,
    profit,
    missing: [...drops, ...entry].filter((l) => l.price === null).map((l) => l.name),
    profitPerHour: min && min > 0 ? (profit * 60) / min : null,
  };
}

export function farmItemNames(bosses: FarmBoss[]): string[] {
  return [...new Set(bosses.flatMap((b) => [...b.entry, ...b.drops].map((i) => i.name)))];
}
