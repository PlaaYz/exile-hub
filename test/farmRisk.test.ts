import { describe, expect, it } from "vitest";
import { farmEv, profitChance, riskOf, type FarmPrice } from "../src/core/farm";
import { farmItemNames } from "../src/core/farm";
import { FARM_BOSSES, FARM_POOLS, type FarmBoss } from "../src/shared/farmData";

const boss = (drops: { name: string; amount: number }[], entry = 10): FarmBoss => ({
  id: "t",
  name: "Test",
  uber: false,
  entry: [{ name: "Key", amount: 1 }],
  drops,
  source: { url: "", note: "" },
});
const prices = (o: Record<string, number>) => new Map<string, FarmPrice>(Object.entries(o).map(([k, chaos]) => [k, { chaos }]));

describe("farm risk", () => {
  it("a guaranteed drop worth more than the entry always profits", () => {
    const r = farmEv(boss([{ name: "Orb", amount: 100 }]), prices({ Key: 10, Orb: 15 }));
    expect(profitChance(r, [], 10, 500)).toBe(1);
    expect(riskOf(r.profit, 1)).toBe("safe");
  });

  it("a rare jackpot with a positive average is high risk", () => {
    // 2% of a 1000c item for a 10c key: +10c on average, but 10 runs usually see nothing
    const r = farmEv(boss([{ name: "Jackpot", amount: 2 }]), prices({ Key: 10, Jackpot: 1000 }));
    expect(r.profit).toBeCloseTo(10);
    const c = profitChance(r, [], 10, 4000)!;
    expect(c).toBeGreaterThan(0.12); // 1 - 0.98^10 = 18%
    expect(c).toBeLessThan(0.25);
    expect(riskOf(r.profit, c)).toBe("high");
  });

  it("a pool drops one item per kill, not several", () => {
    // two 50% uniques worth 6c each, key 10c: independent they could pay 12c, as a pool never more than 6c
    const r = farmEv(boss([{ name: "A", amount: 50 }, { name: "B", amount: 50 }]), prices({ Key: 10, A: 30, B: 30 }));
    expect(profitChance(r, [["A", "B"]], 1, 2000)).toBe(1);
    const r2 = farmEv(boss([{ name: "A", amount: 50 }, { name: "B", amount: 50 }]), prices({ Key: 10, A: 6, B: 6 }));
    expect(r2.profit).toBeLessThan(0);
    expect(profitChance(r2, [["A", "B"]], 1, 2000)).toBeNull();
    expect(riskOf(r2.profit, null)).toBe("negative");
  });

  it("every pool names real drops; a T17 map has a fixed entry price and is not looked up", () => {
    const t17 = FARM_BOSSES.find((b) => b.id === "t17-citadel")!;
    expect(farmEv(t17, prices({})).entryCost).toBe(50);
    expect(farmItemNames(FARM_BOSSES)).not.toContain("Nightmare Map (T17)");
    for (const b of FARM_BOSSES) {
      const names = new Set(b.drops.map((d) => d.name));
      for (const pool of FARM_POOLS[b.id] ?? []) for (const n of pool) expect(names.has(n), `${b.id}: ${n}`).toBe(true);
    }
    expect(new Set(FARM_BOSSES.map((b) => b.id)).size).toBe(FARM_BOSSES.length);
  });
});
