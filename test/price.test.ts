import { describe, expect, it } from "vitest";
import { parseItem } from "../src/core/item";
import { NinjaClient, pickGem, pickUnique, type FetchFn, type StashLine } from "../src/core/ninja";
import { PriceChecker, median } from "../src/core/pricecheck";
import { StatIndex, template } from "../src/core/stats";
import { TradeClient, buildQuery, defaultFilters, defaultLeague, defaultMin, type TradeFetch } from "../src/core/trade";
import type { PriceView } from "../src/shared/types";

const sep = "--------";
const txt = (...p: string[]) => p.join("\n");
const ring = txt(
  "Item Class: Rings",
  "Rarity: Rare",
  "Doom Spiral",
  "Two-Stone Ring",
  sep,
  "Item Level: 84",
  sep,
  "+12% to Fire and Lightning Resistances (implicit)",
  sep,
  "+68 to maximum Life",
  "+40% to Cold Resistance",
  "Some mod the trade site does not know",
);
const tabula = txt("Item Class: Body Armours", "Rarity: Unique", "Tabula Rasa", "Simple Robe", sep, "Sockets: W-W-W-W-W-W", sep, "Item Level: 68");
const chaosStack = txt("Item Class: Stackable Currency", "Rarity: Currency", "Divine Orb", sep, "Stack Size: 3/10");

const stats = new StatIndex({
  result: [
    {
      id: "explicit",
      entries: [
        { id: "explicit.life", text: "+# to maximum Life", type: "explicit" },
        { id: "explicit.cold", text: "+#% to Cold Resistance", type: "explicit" },
        { id: "explicit.phys_local", text: "Adds # to # Physical Damage (Local)", type: "explicit" },
        { id: "explicit.phys", text: "Adds # to # Physical Damage", type: "explicit" },
        { id: "explicit.mana_cost", text: "#% increased Mana Cost of Skills", type: "explicit" },
        { id: "explicit.opt", text: "Allocates #", type: "explicit", option: { options: [] } },
      ],
    },
    { id: "implicit", entries: [{ id: "implicit.firelight", text: "+#% to Fire and Lightning Resistances", type: "implicit" }] },
  ],
});

describe("stats", () => {
  it("templates numbers keeping the sign", () => {
    expect(template("Adds 3 to 7 Physical Damage")).toEqual({ key: "Adds # to # Physical Damage", values: [3, 7] });
    expect(template("+38% to Cold Resistance").key).toBe("+#% to Cold Resistance");
  });

  it("matches mods, local variants and reduced -> increased", () => {
    expect(stats.match({ text: "+68 to maximum Life", kind: "explicit" }, false)).toMatchObject({ statId: "explicit.life", value: 68 });
    expect(stats.match({ text: "Adds 10 to 20 Physical Damage", kind: "explicit" }, true)).toMatchObject({
      statId: "explicit.phys_local",
      value: 15,
    });
    expect(stats.match({ text: "Adds 10 to 20 Physical Damage", kind: "explicit" }, false)?.statId).toBe("explicit.phys");
    expect(stats.match({ text: "10% reduced Mana Cost of Skills", kind: "explicit" }, false)).toMatchObject({
      statId: "explicit.mana_cost",
      value: -10,
    });
    expect(stats.match({ text: "Allocates Foo", kind: "explicit" }, false)).toBeNull();
    expect(stats.match({ text: "+68 to maximum Life", kind: "crafted" }, false)).toBeNull();
  });
});

describe("ninja picking", () => {
  const lines: StashLine[] = [
    { name: "Tabula Rasa", baseType: "Simple Robe", chaosValue: 10, listingCount: 100 },
    { name: "Tabula Rasa", baseType: "Simple Robe", links: 6, chaosValue: 15, listingCount: 50 },
  ];
  it("prefers the line with the same link count", () => {
    expect(pickUnique(lines, parseItem(tabula)!)?.chaosValue).toBe(15);
    const unlinked = parseItem(tabula.replace("W-W-W-W-W-W", "W W"))!;
    expect(pickUnique(lines, unlinked)?.chaosValue).toBe(10);
  });

  it("picks the exact gem variant, else the closest one below", () => {
    const gems: StashLine[] = [
      { name: "Cyclone", gemLevel: 1, gemQuality: 0, chaosValue: 1 },
      { name: "Cyclone", gemLevel: 20, gemQuality: 0, chaosValue: 5 },
      { name: "Cyclone", gemLevel: 20, gemQuality: 20, chaosValue: 9 },
      { name: "Cyclone", gemLevel: 21, gemQuality: 20, corrupted: true, chaosValue: 40 },
    ];
    const g = (lvl: number, q: number, corrupted = false) =>
      parseItem(txt("Item Class: Skill Gems", "Rarity: Gem", "Cyclone", sep, `Level: ${lvl}`, `Quality: +${q}%`, ...(corrupted ? [sep, "Corrupted"] : [])))!;
    expect(pickGem(gems, g(20, 20))?.chaosValue).toBe(9);
    expect(pickGem(gems, g(20, 10))?.chaosValue).toBe(5);
    expect(pickGem(gems, g(21, 20, true))?.chaosValue).toBe(40);
    expect(pickGem(gems, g(5, 0, true))).toBeNull();
  });
});

describe("trade query", () => {
  it("builds a rare search by category with enabled stat filters", () => {
    const item = parseItem(ring)!;
    const q = buildQuery(
      item,
      [
        { text: "", kind: "explicit", statId: "explicit.life", value: 68, min: 61, enabled: true },
        { text: "", kind: "implicit", statId: "implicit.firelight", value: 12, min: 10, enabled: false },
      ],
      defaultFilters(item, null, null),
    ) as any;
    expect(q.query.filters.type_filters.filters).toEqual({ category: { option: "accessory.ring" }, rarity: { option: "nonunique" } });
    expect(q.query.stats[0].filters).toEqual([{ id: "explicit.life", value: { min: 61 }, disabled: false }]);
    expect(q.sort).toEqual({ price: "asc" });
  });

  it("searches uniques by name/base with links and corruption", () => {
    const item = parseItem(tabula)!;
    const q = buildQuery(item, [], defaultFilters(item, null, null)) as any;
    expect(q.query).toMatchObject({ name: "Tabula Rasa", type: "Simple Robe" });
    expect(q.query.filters.socket_filters.filters.links).toEqual({ min: 6 });
    expect(q.query.filters.misc_filters.filters.corrupted).toEqual({ option: "false" });
  });

  it("default min sits ~10% under the roll", () => {
    expect(defaultMin(68)).toBe(61);
    expect(defaultMin(2.5)).toBe(2.2);
    expect(defaultMin(-9)).toBeNull();
    expect(defaultMin(null)).toBeNull();
  });

  it("picks the challenge league", () => {
    expect(defaultLeague(["Allflame", "Hardcore Allflame", "Standard", "Hardcore"])).toBe("Allflame");
    expect(defaultLeague(["Standard", "Hardcore"])).toBe("Standard");
  });

  it("median", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

// ---- end to end with fake HTTP --------------------------------------------------

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  ok: true,
  status: 200,
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  json: async () => body,
});

function fakeNinja(): { fn: FetchFn; calls: string[] } {
  const calls: string[] = [];
  const fn: FetchFn = async (url) => {
    calls.push(url);
    if (url.includes("exchange") && url.includes("type=Currency")) {
      return json({
        core: { rates: { divine: 0.005 } },
        lines: [{ id: "divine", primaryValue: 200 }],
        items: [{ id: "divine", name: "Divine Orb" }],
      });
    }
    if (url.includes("UniqueArmour")) {
      return json({ lines: [{ name: "Tabula Rasa", baseType: "Simple Robe", links: 6, chaosValue: 40, listingCount: 3 }] });
    }
    return json({ lines: [], items: [] });
  };
  return { fn, calls };
}

function fakeTrade(): { fn: TradeFetch; bodies: any[] } {
  const bodies: any[] = [];
  const rl = { "x-rate-limit-rules": "Ip", "x-rate-limit-ip": "5:10:60", "x-rate-limit-ip-state": "1:10:0" };
  const fn: TradeFetch = async (url, init) => {
    if (init?.method === "POST") {
      bodies.push(JSON.parse(init.body!));
      return json({ id: "abc", total: 2, result: ["r1", "r2"] }, rl);
    }
    return json(
      {
        result: [
          { listing: { indexed: "2026-11-08T10:00:00Z", price: { amount: 1, currency: "divine" } } },
          { listing: { indexed: "2026-11-08T10:00:00Z", price: { amount: 300, currency: "chaos" } } },
        ],
      },
      rl,
    );
  };
  return { fn, bodies };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("PriceChecker", () => {
  const make = () => {
    const n = fakeNinja();
    const t = fakeTrade();
    const views: PriceView[] = [];
    const pc = new PriceChecker({
      ninja: new NinjaClient(n.fn, "test"),
      trade: new TradeClient(t.fn, "test"),
      stats: async () => stats,
      onUpdate: (v) => views.push(v),
      now: () => 1000,
    });
    return { pc, views, n, t };
  };

  it("ignores text that is not an item", () => {
    expect(make().pc.check("hello", "Allflame")).toBe(false);
  });

  it("prices a unique with ninja + trade and converts divines", async () => {
    const { pc, t } = make();
    expect(pc.check(tabula, "Allflame")).toBe(true);
    await settle();
    const v = pc.view!;
    expect(v.ninjaStatus).toBe("done");
    expect(v.ninja).toMatchObject({ chaos: 40, divine: 0.2, lowConfidence: true });
    expect(v.chaosPerDivine).toBe(200);
    expect(v.tradeStatus).toBe("done");
    expect(v.trade?.listings.map((l) => l.chaos)).toEqual([200, 300]);
    expect(v.trade?.medianChaos).toBe(250);
    expect(v.trade?.url).toBe("https://www.pathofexile.com/trade/search/Allflame/abc");
    expect(t.bodies[0].query.name).toBe("Tabula Rasa");
  });

  it("prices stackable currency on ninja only", async () => {
    const { pc, t } = make();
    pc.check(chaosStack, "Allflame");
    await settle();
    expect(pc.view).toMatchObject({ tradeStatus: "n/a", ninjaStatus: "done", ninja: { chaos: 200 } });
    expect(t.bodies).toHaveLength(0);
  });

  it("maps rare mods, searches with explicits on and lets the user re-search", async () => {
    const { pc, t } = make();
    pc.check(ring, "Allflame");
    await settle();
    const v = pc.view!;
    // resistances and life go in as the trade site's totals (the lines they add up start off)
    expect(v.mods.map((m) => [m.statId, m.enabled, m.min])).toEqual([
      ["pseudo.pseudo_total_elemental_resistance", true, 57],
      ["pseudo.pseudo_total_life", true, 61],
      ["implicit.firelight", false, 10],
      ["explicit.life", false, 61],
      ["explicit.cold", false, 36],
    ]);
    expect(v.unmatched).toEqual(["Some mod the trade site does not know"]);
    expect(t.bodies[0].query.stats[0].filters.map((f: any) => f.id)).toEqual(["pseudo.pseudo_total_elemental_resistance", "pseudo.pseudo_total_life"]);
    // only 2 results: the same search with minimums 20% lower ("similar items") runs too
    expect(t.bodies[1].query.stats[0].filters.map((f: any) => f.value.min)).toEqual([45, 48]);
    expect(pc.view!.similar?.total).toBe(2);

    pc.research({
      mods: v.mods.map((m) => ({ statId: m.statId, enabled: m.statId === "explicit.life", min: m.statId === "explicit.life" ? 50 : m.min, max: m.statId === "explicit.life" ? 80 : null })),
      filters: { ...v.filters, status: "any" as const },
    });
    await settle();
    expect(t.bodies[2].query.stats[0].filters).toEqual([{ id: "explicit.life", value: { min: 50, max: 80 }, disabled: false }]);
    expect(t.bodies[2].query.status).toEqual({ option: "any" });
  });

  it("drops results of an item that was replaced by a newer copy", async () => {
    const { pc } = make();
    pc.check(ring, "Allflame");
    pc.check(chaosStack, "Allflame");
    await settle();
    expect(pc.view?.item.name).toBe("Divine Orb");
    expect(pc.view?.trade).toBeNull();
  });
});
