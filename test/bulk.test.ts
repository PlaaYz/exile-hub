import { describe, expect, it } from "vitest";
import { NinjaClient, type FetchFn } from "../src/core/ninja";
import { PriceChecker } from "../src/core/pricecheck";
import { StatIndex } from "../src/core/stats";
import { TradeClient, staticIds, type TradeFetch } from "../src/core/trade";
import type { PriceView } from "../src/shared/types";

const headers = { get: () => null };
const ok = (body: unknown) => ({ ok: true, status: 200, headers, json: async () => body });

const exchangeBody = {
  id: "abc",
  total: 3,
  result: {
    h1: {
      listing: {
        indexed: "2026-11-09T10:00:00Z",
        account: { name: "Acc1", lastCharacterName: "Char1", online: { league: "X" } },
        offers: [{ exchange: { currency: "chaos", amount: 450 }, item: { currency: "divine", amount: 3, stock: 30 } }],
      },
    },
    h2: {
      listing: {
        indexed: "2026-11-09T10:00:00Z",
        account: { name: "Acc2", lastCharacterName: "Char2", online: { league: "X", status: "afk" } },
        offers: [{ exchange: { currency: "chaos", amount: 140 }, item: { currency: "divine", amount: 1, stock: 5 } }],
      },
    },
    h3: { listing: { account: { name: "Acc3", online: null }, offers: [{ exchange: { currency: "chaos", amount: 160 }, item: { amount: 1 } }] } },
  },
};

describe("bulk exchange", () => {
  it("maps names to exchange ids from the trade site's static data", () => {
    const ids = staticIds({ result: [{ entries: [{ id: "divine", text: "Divine Orb" }, { id: "chaos", text: "Chaos Orb" }] }] });
    expect(ids.get("Divine Orb")).toBe("divine");
  });

  it("parses offers with seller status", async () => {
    const bodies: any[] = [];
    const f: TradeFetch = async (_url, init) => {
      bodies.push(JSON.parse(init!.body!));
      return ok(exchangeBody);
    };
    const r = await new TradeClient(f, "test").exchange("Allflame", "divine", ["chaos"]);
    expect(bodies[0]).toMatchObject({ query: { status: { option: "securable" }, have: ["chaos"], want: ["divine"] }, engine: "new" });
    expect(r.url).toBe("https://www.pathofexile.com/trade/exchange/Allflame/abc");
    expect(r.offers.map((o) => [o.pay.amount, o.get.amount, o.get.stock, o.status])).toEqual([
      [450, 3, 30, "online"],
      [140, 1, 5, "afk"],
      [160, 1, 1, "offline"],
    ]);
  });

  it("price check of a stack shows offers cheapest per unit first", async () => {
    const trade = new TradeClient(async () => ok(exchangeBody), "test");
    const ninjaFetch: FetchFn = async () => ({ ok: true, status: 200, json: async () => ({ lines: [], items: [], core: { rates: {} } }) });
    let view: PriceView | null = null;
    const pc = new PriceChecker({
      ninja: new NinjaClient(ninjaFetch, "test"),
      trade,
      stats: async () => new StatIndex({ result: [] }),
      staticIds: async () => new Map([["Divine Orb", "divine"]]),
      onUpdate: (v) => (view = v),
    });
    pc.check(["Item Class: Stackable Currency", "Rarity: Currency", "Divine Orb", "--------", "Stack Size: 3/10"].join("\n"), "Allflame");
    await new Promise((r) => setTimeout(r, 20));
    const v = view as unknown as PriceView;
    expect(v.bulkStatus).toBe("done");
    expect(v.bulk!.offers.map((o) => o.chaosPerUnit)).toEqual([140, 150, 160]);
    expect(v.tradeStatus).toBe("n/a");
  });
});

describe("listing whispers", () => {
  it("keeps the trade site's whisper, never for instant buyout or a multi-line text", async () => {
    const listing = (method: string, whisper: string) => ({
      listing: { method, indexed: "", whisper, account: { name: "a#1", lastCharacterName: "Ch", online: { league: "x" } }, price: { amount: 1, currency: "chaos" } },
    });
    const body = { result: [listing("psonline", "@Ch Hi, I would like to buy your X"), listing("psapi", "@Ch hi"), listing("psonline", "@Ch a\n/kick me")] };
    const r = await new TradeClient(async () => ok(body), "test").fetchListings("q", ["1", "2", "3"]);
    expect(r.map((l) => l.whisper)).toEqual(["@Ch Hi, I would like to buy your X", undefined, undefined]);
  });
});
