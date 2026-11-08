import { describe, expect, it } from "vitest";
import { mapModStatIds, mapTradeQuery, normaliseModText, tradeSearchUrl } from "../src/core/mapTrade";
import { MAP_MODS } from "../src/core/searchRegex";

// the trade site's wording for a few map mods (from /api/trade/data/stats)
const stats = {
  result: [
    {
      id: "explicit",
      entries: [
        { id: "explicit.stat_3464419871", text: "Monsters reflect #% of Physical Damage", type: "explicit" },
        { id: "explicit.stat_2764017512", text: "Monsters reflect #% of Elemental Damage", type: "explicit" },
        { id: "explicit.stat_1910157106", text: "Players cannot Regenerate Life, Mana or Energy Shield", type: "explicit" },
        { id: "explicit.stat_3376488707", text: "Players have #% to all maximum Resistances", type: "explicit" },
        { id: "explicit.stat_941368244", text: "Players have #% more Cooldown Recovery Rate", type: "explicit" },
        { id: "explicit.stat_569299859", text: "+#% to all maximum Resistances", type: "explicit" },
      ],
    },
    { id: "implicit", entries: [{ id: "implicit.x", text: "Monsters reflect #% of Physical Damage", type: "implicit" }] },
  ],
};

describe("map trade search", () => {
  it("normalises PoB and trade wordings to the same key", () => {
    expect(normaliseModText("players have minus ( to )% to all maximum resistances")).toBe(normaliseModText("Players have #% to all maximum Resistances"));
    expect(normaliseModText("Monsters reflect 18% of Physical Damage")).toBe("monsters reflect % of physical damage");
  });

  it("maps our mods to explicit trade stat ids, using the trade wording when given", () => {
    const ids = mapModStatIds(stats);
    expect(ids.get("phys-reflect")).toBe("explicit.stat_3464419871");
    expect(ids.get("max-res")).toBe("explicit.stat_3376488707"); // not the item mod "+#% to all maximum Resistances"
    expect(ids.get("less-cdr")).toBe("explicit.stat_941368244");
    expect(ids.has("hexproof")).toBe(false); // not in this small list
    expect(MAP_MODS.find((m) => m.id === "less-cdr")?.tradeText).toBeTruthy();
  });

  it("builds a map search with a 'not' group, map filters and cheapest first", () => {
    const { query, missing } = mapTradeQuery(
      { exclude: ["phys-reflect", "no-regen", "hexproof"], minQuantity: 70, minPackSize: 20, tierMin: 16, tierMax: 16, rarity: "rare", corrupted: "no" },
      mapModStatIds(stats),
    ) as { query: any; missing: string[] };
    expect(missing).toEqual(["Monstros imunes a hex (Hexproof)"]);
    expect(query.sort).toEqual({ price: "asc" });
    expect(query.query.stats[1]).toEqual({ type: "not", filters: [{ id: "explicit.stat_3464419871" }, { id: "explicit.stat_1910157106" }] });
    expect(query.query.filters.type_filters.filters).toEqual({ category: { option: "map" }, rarity: { option: "rare" } });
    expect(query.query.filters.map_filters.filters).toEqual({ map_tier: { min: 16, max: 16 }, map_iiq: { min: 70 }, map_packsize: { min: 20 } });
    expect(query.query.filters.misc_filters.filters.corrupted).toEqual({ option: "false" });
  });

  it("any rarity means any non-unique map, and no empty filter groups", () => {
    const { query } = mapTradeQuery(
      { exclude: [], minQuantity: null, minPackSize: null, tierMin: null, tierMax: null, rarity: "any", corrupted: "any" },
      new Map(),
    ) as { query: any };
    expect(query.query.filters.type_filters.filters.rarity).toEqual({ option: "nonunique" });
    expect(query.query.filters.map_filters).toBeUndefined();
    expect(query.query.stats).toHaveLength(1);
  });

  it("builds a ?q= fallback link", () => {
    const url = tradeSearchUrl("Allflame", { query: { a: 1 } });
    expect(url.startsWith("https://www.pathofexile.com/trade/search/Allflame?q=")).toBe(true);
    expect(JSON.parse(decodeURIComponent(url.split("?q=")[1]))).toEqual({ query: { a: 1 } });
  });
});
