import { describe, expect, it } from "vitest";
import { parseLine } from "../src/core/clientLog";
import { parseTradeWhisper } from "../src/core/tradeWhisper";

describe("trade whispers", () => {
  it("single item with stash position", () => {
    expect(
      parseTradeWhisper('Hi, I would like to buy your Tabula Rasa Simple Robe listed for 10 chaos in Allflame (stash tab "~price 10 chaos"; position: left 5, top 3)'),
    ).toEqual({
      item: "Tabula Rasa Simple Robe",
      price: { amount: 10, currency: "chaos" },
      league: "Allflame",
      stash: { tab: "~price 10 chaos", left: 5, top: 3 },
      bulk: null,
      note: null,
    });
  });

  it("decimal price, a note after the template, no stash position", () => {
    expect(parseTradeWhisper("Hi, I would like to buy your level 21 23% Vaal Grace listed for 1.5 divine in Hardcore Allflame.")).toMatchObject({
      item: "level 21 23% Vaal Grace",
      price: { amount: 1.5, currency: "divine" },
      league: "Hardcore Allflame",
      stash: null,
    });
    expect(
      parseTradeWhisper('Hi, I would like to buy your Headhunter Leather Belt listed for 120 divine in Allflame (stash tab "sell"; position: left 1, top 1) ty'),
    ).toMatchObject({ price: { amount: 120, currency: "divine" }, note: "ty", stash: { tab: "sell", left: 1, top: 1 } });
  });

  it("unpriced listing", () => {
    expect(parseTradeWhisper('Hi, I would like to buy your Mageblood Heavy Belt in Allflame (stash tab "x"; position: left 2, top 4)')).toMatchObject({
      item: "Mageblood Heavy Belt",
      price: null,
      league: "Allflame",
    });
  });

  it("bulk exchange", () => {
    expect(parseTradeWhisper("Hi, I'd like to buy your 10 Divine Orb for my 4,500 Chaos Orb in Allflame.")).toEqual({
      item: "Divine Orb",
      price: null,
      league: "Allflame",
      stash: null,
      bulk: { count: 10, pay: { amount: 4500, currency: "Chaos Orb" } },
      note: null,
    });
  });

  it("ordinary whispers are not read; the log line keeps only the sender", () => {
    expect(parseTradeWhisper("hey, are you still there?")).toBeNull();
    expect(parseLine("2026/11/09 12:00:00 1 a [INFO Client 1] @From <GLD> Buyer_1: hello there")).toEqual({
      type: "whisper",
      from: "Buyer_1",
      ts: new Date(2026, 10, 9, 12, 0, 0).getTime(),
    });
    expect(
      parseLine("2026/11/09 12:00:00 1 a [INFO Client 1] @From Buyer_1: Hi, I would like to buy your Tabula Rasa Simple Robe listed for 10 chaos in Allflame"),
    ).toMatchObject({ type: "whisper", from: "Buyer_1", offer: { item: "Tabula Rasa Simple Robe" } });
    expect(parseLine("2026/11/09 12:00:00 1 a [INFO Client 1] : Buyer_1 has joined the area.")).toMatchObject({ type: "join", name: "Buyer_1" });
  });
});
