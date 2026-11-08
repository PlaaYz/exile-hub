import { describe, expect, it } from "vitest";
import { farmEv, farmItemNames, type FarmPrice } from "../src/core/farm";
import { NinjaClient, priceByName, type FetchFn } from "../src/core/ninja";
import { FARM_BOSSES, type FarmBoss } from "../src/shared/farmData";

const boss: FarmBoss = {
  id: "t",
  name: "Test",
  uber: false,
  entry: [{ name: "Key", amount: 2 }],
  drops: [
    { name: "Big", amount: 10 }, // 10 per 100 kills
    { name: "Small", amount: 50 },
    { name: "Unknown", amount: 5 },
  ],
  source: { url: "", note: "" },
};
const prices = new Map<string, FarmPrice>([
  ["Key", { chaos: 30 }],
  ["Big", { chaos: 500 }],
  ["Small", { chaos: 20, lowConfidence: true }],
]);

describe("farmEv", () => {
  it("sums drops per kill times price minus the entry", () => {
    const r = farmEv(boss, prices);
    expect(r.dropsValue).toBeCloseTo(0.1 * 500 + 0.5 * 20); // 60
    expect(r.entryCost).toBe(60);
    expect(r.profit).toBeCloseTo(0);
    expect(r.missing).toEqual(["Unknown"]);
    expect(r.drops.find((d) => d.name === "Small")?.lowConfidence).toBe(true);
    expect(r.profitPerHour).toBeNull();
  });

  it("applies user overrides for amounts, prices and time", () => {
    const r = farmEv(boss, prices, {
      amounts: { Big: 20 },
      prices: { Unknown: 100, Key: 10 },
      minutesPerRun: 5,
    });
    expect(r.dropsValue).toBeCloseTo(0.2 * 500 + 0.5 * 20 + 0.05 * 100); // 115
    expect(r.entryCost).toBe(20);
    expect(r.profit).toBeCloseTo(95);
    expect(r.profitPerHour).toBeCloseTo(95 * 12);
    expect(r.missing).toEqual([]);
    const big = r.drops.find((d) => d.name === "Big")!;
    expect(big).toMatchObject({ amount: 20, amountEdited: true, priceManual: false });
    expect(r.drops.find((d) => d.name === "Small")?.lowConfidence).toBe(true);
  });

  it("default tables are well formed", () => {
    const ids = new Set<string>();
    for (const b of FARM_BOSSES) {
      expect(ids.has(b.id), b.id).toBe(false);
      ids.add(b.id);
      expect(b.entry.length).toBeGreaterThan(0);
      expect(b.drops.length).toBeGreaterThan(0);
      expect(b.source.url).toMatch(/^https:\/\//);
      for (const i of [...b.entry, ...b.drops]) {
        expect(i.amount, `${b.name}: ${i.name}`).toBeGreaterThan(0);
        expect(i.amount).toBeLessThanOrEqual(100);
      }
    }
    expect(farmItemNames(FARM_BOSSES).length).toBeGreaterThan(50);
  });
});

describe("priceByName", () => {
  const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
  const fetchFn: FetchFn = async (url) => {
    if (url.includes("exchange") && url.includes("type=Fragment")) {
      return json({ lines: [{ id: "key", primaryValue: 30 }], items: [{ id: "key", name: "Key" }] });
    }
    if (url.includes("exchange")) return json({ lines: [], items: [] });
    if (url.includes("UniqueJewel")) {
      return json({
        lines: [
          { name: "Forbidden Flame", chaosValue: 100, listingCount: 20, variant: "A" },
          { name: "Forbidden Flame", chaosValue: 300, listingCount: 20, variant: "B" },
          { name: "Forbidden Flame", chaosValue: 900, listingCount: 20, variant: "C" },
          { name: "Forbidden Flame", chaosValue: 99999, listingCount: 1, variant: "price fixer" },
        ],
      });
    }
    if (url.includes("SkillGem")) {
      return json({
        lines: [
          { name: "Empower Support", gemLevel: 4, gemQuality: 0, chaosValue: 500, listingCount: 50 },
          { name: "Empower Support", gemLevel: 1, gemQuality: 0, chaosValue: 20, listingCount: 50 },
          { name: "Empower Support", gemLevel: 1, gemQuality: 0, corrupted: true, chaosValue: 5, listingCount: 50 },
        ],
      });
    }
    return json({ lines: [] });
  };

  it("finds exchange items, takes the median of unique variants and the plain gem", async () => {
    const out = await priceByName(new NinjaClient(fetchFn, "t"), "L", ["Key", "Forbidden Flame", "Empower Support", "Nope"]);
    expect(out.get("Key")?.chaos).toBe(30);
    expect(out.get("Forbidden Flame")).toMatchObject({ chaos: 300, variants: 4, lowConfidence: false });
    expect(out.get("Empower Support")?.chaos).toBe(20);
    expect(out.has("Nope")).toBe(false);
  });
});
