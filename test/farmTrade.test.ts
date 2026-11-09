import { describe, expect, it } from "vitest";
import { isSuspect, needsTradePrice, tradePriceByName } from "../src/core/farmTrade";
import type { TradeClient } from "../src/core/trade";

describe("farm prices from the trade site", () => {
  it("only missing or joke-priced items are looked up", () => {
    const cpd = 500;
    expect(needsTradePrice(undefined, cpd)).toBe(true);
    // 880k chaos from 11 listings (a joke listing on poe.ninja)
    expect(isSuspect({ chaos: 880_000, listings: 11, lowConfidence: false, variants: 1 }, cpd)).toBe(true);
    // expensive but well listed: trusted
    expect(needsTradePrice({ chaos: 60_000, listings: 150, lowConfidence: false, variants: 1 }, cpd)).toBe(false);
    expect(needsTradePrice({ chaos: 300, listings: 3, lowConfidence: true, variants: 1 }, cpd)).toBe(false);
  });

  it("searches by unique name, then by item type, and takes the median in chaos", async () => {
    const queries: any[] = [];
    const trade = {
      search: async (_league: string, q: any) => {
        queries.push(q.query);
        if (q.query.name) throw new Error("HTTP 400: Unknown item name");
        return {
          id: "x",
          total: 3,
          url: "",
          rest: [],
          listings: [
            { amount: 10, currency: "chaos" },
            { amount: 1, currency: "divine" },
            { amount: 30, currency: "chaos" },
          ],
        };
      },
    } as unknown as TradeClient;
    const p = await tradePriceByName(trade, "L", "Archive Reliquary Key", new Map([["divine", 500]]));
    expect(queries.map((q) => Object.keys(q).filter((k) => k !== "status")[0])).toEqual(["name", "type"]);
    expect(queries[1].status).toEqual({ option: "securable" });
    expect(p).toEqual({ chaos: 30, listings: 3 });
  });

  it("the trade site's item list says how to search each name (one search per item)", async () => {
    const { itemQueryKeys } = await import("../src/core/trade");
    const keys = itemQueryKeys({
      result: [
        { id: "weapon", entries: [{ type: "Infernal Sword" }, { name: "Voidforge", type: "Infernal Sword", flags: { unique: true } }] },
        { id: "currency", entries: [{ type: "Archive Reliquary Key" }] },
      ],
    });
    expect(keys.get("Voidforge")).toEqual({ name: "Voidforge", type: "Infernal Sword" });
    expect(keys.get("Archive Reliquary Key")).toEqual({ type: "Archive Reliquary Key" });
    const queries: any[] = [];
    const trade = {
      search: async (_l: string, q: any) => {
        queries.push(q.query);
        return { id: "x", total: 1, url: "", rest: [], listings: [{ amount: 70, currency: "divine" }] };
      },
    } as unknown as TradeClient;
    expect(await tradePriceByName(trade, "L", "Voidforge", new Map([["divine", 500]]), keys.get("Voidforge"))).toEqual({ chaos: 35000, listings: 1 });
    expect(queries).toEqual([{ status: { option: "securable" }, name: "Voidforge", type: "Infernal Sword" }]);
  });

  it("no listing at all: null after trying instant buyout and online", async () => {
    const statuses: string[] = [];
    const trade = {
      search: async (_l: string, q: any) => {
        statuses.push(q.query.status.option);
        return { id: "x", total: 0, url: "", rest: [], listings: [] };
      },
    } as unknown as TradeClient;
    expect(await tradePriceByName(trade, "L", "Nook's Crown", null)).toBeNull();
    expect(statuses.slice(0, 2)).toEqual(["securable", "online"]);
  });
});
