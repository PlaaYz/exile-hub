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
  const price = manual ?? live?.chaos ?? item.price ?? null;
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

/** Names to price on the market (items with a fixed price, like a T17 map, are not looked up). */
export function farmItemNames(bosses: FarmBoss[]): string[] {
  return [...new Set(bosses.flatMap((b) => [...b.entry, ...b.drops].filter((i) => i.price === undefined).map((i) => i.name)))];
}

// ---- risk: how often a batch of runs ends up ahead -------------------------------------------

export type FarmRisk = "safe" | "low" | "medium" | "high" | "negative";

/** Same groups as the usual boss calculators: 95%+, 80-95%, 60-80%, under 60%, losing on average. */
export function riskOf(profit: number, chance: number | null): FarmRisk {
  if (profit < 0 || chance === null) return "negative";
  if (chance >= 0.95) return "safe";
  if (chance >= 0.8) return "low";
  if (chance >= 0.6) return "medium";
  return "high";
}

/** Small deterministic generator: the same tables give the same chance on every redraw. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Chance that `runs` kills in a row end with more chaos than they cost, by simulation: each drop
 * line falls independently with its rate (amounts over 100 = that many plus a chance of one more),
 * except the lines of a pool (the boss's unique pool, the astrolabe), of which at most one falls
 * per kill. Items without a price count as 0, like in the average. null = the average is negative.
 */
export function profitChance(r: FarmResult, pools: readonly (readonly string[])[] = [], runs = 10, trials = 4000): number | null {
  if (r.profit < 0) return null;
  const pooled = new Set(pools.flat());
  const free = r.drops
    .filter((l) => !pooled.has(l.name) && l.price !== null && l.price > 0 && l.amount > 0)
    .map((l) => ({ per: l.amount / 100, price: l.price! }));
  const groups = pools
    .map((names) =>
      r.drops.filter((l) => names.includes(l.name) && l.price !== null && l.amount > 0).map((l) => ({ p: l.amount / 100, price: l.price! })),
    )
    .filter((g) => g.length > 0);
  const rand = rng(r.drops.length * 7919 + Math.round(r.entryCost));
  let ahead = 0;
  for (let t = 0; t < trials; t++) {
    let total = -r.entryCost * runs;
    for (let k = 0; k < runs; k++) {
      for (const d of free) {
        const whole = Math.floor(d.per);
        total += (whole + (rand() < d.per - whole ? 1 : 0)) * d.price;
      }
      for (const g of groups) {
        let u = rand();
        for (const d of g) {
          if (u < d.p) {
            total += d.price;
            break;
          }
          u -= d.p;
        }
      }
    }
    if (total > 0) ahead++;
  }
  return ahead / trials;
}
