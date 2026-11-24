import { describe, expect, it } from "vitest";
import { parseItem } from "../src/core/item";
import { NinjaClient, defaultLeague, fetchLeagues, isChallengeLeague, isSuspect, pickGem, pickUnique, type FetchFn, type StashLine } from "../src/core/ninja";
import { PriceChecker } from "../src/core/pricecheck";

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

describe("leagues and joke listings", () => {
  it("picks the challenge league", () => {
    expect(defaultLeague(["Allflame", "Hardcore Allflame", "Standard", "Hardcore"])).toBe("Allflame");
    expect(defaultLeague(["Standard", "Hardcore"])).toBe("Standard");
    expect(["Standard", "Hardcore", "Ruthless", "Hardcore Ruthless"].some(isChallengeLeague)).toBe(false);
    expect(isChallengeLeague("HC Ruthless Allflame")).toBe(false);
  });

  it("reads poe.ninja's league list", async () => {
    const fn: FetchFn = async () => json([{ id: "Covens", name: "Covens" }, { id: "Standard", name: "Standard" }]);
    expect(await fetchLeagues(fn, "test")).toEqual(["Covens", "Standard"]);
  });

  it("only a high price with few listings is suspect", () => {
    const p = (chaos: number, listings: number | null) => ({ chaos, listings, lowConfidence: false, variants: 1 });
    expect(isSuspect(p(880_000, 11), 500)).toBe(true);
    expect(isSuspect(p(60_000, 150), 500)).toBe(false);
    expect(isSuspect(p(300, 3), 500)).toBe(false);
    expect(isSuspect(p(400_000, null), 500)).toBe(false); // Mirror: currency exchange
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

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("PriceChecker", () => {
  const make = () => {
    const pc = new PriceChecker({ ninja: new NinjaClient(fakeNinja().fn, "test"), onUpdate: () => {}, now: () => 1000 });
    return pc;
  };

  it("ignores text that is not an item", () => {
    expect(make().check("hello", "Allflame")).toBe(false);
  });

  it("prices a unique and converts to divines", async () => {
    const pc = make();
    expect(pc.check(tabula, "Allflame")).toBe(true);
    await settle();
    expect(pc.view!.ninjaStatus).toBe("done");
    expect(pc.view!.ninja).toMatchObject({ chaos: 40, divine: 0.2, lowConfidence: true });
    expect(pc.view!.chaosPerDivine).toBe(200);
  });

  it("prices stackable currency; rares have no price", async () => {
    const pc = make();
    pc.check(chaosStack, "Allflame");
    await settle();
    expect(pc.view).toMatchObject({ ninjaStatus: "done", ninja: { chaos: 200 } });
    pc.check(ring, "Allflame");
    await settle();
    expect(pc.view).toMatchObject({ ninjaStatus: "n/a", ninja: null });
  });

  it("drops results of an item that was replaced by a newer copy", async () => {
    const pc = make();
    pc.check(tabula, "Allflame");
    pc.check(chaosStack, "Allflame");
    await settle();
    expect(pc.view?.item.name).toBe("Divine Orb");
    expect(pc.view?.ninja?.chaos).toBe(200);
  });
});
