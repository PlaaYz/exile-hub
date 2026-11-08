import { describe, expect, it } from "vitest";
import { looksLikeItem, parseItem } from "../src/core/item";

const sep = "--------";
const txt = (...parts: string[]) => parts.join("\r\n");

describe("parseItem", () => {
  it("rejects non-item text", () => {
    expect(looksLikeItem("hello")).toBe(false);
    expect(parseItem("Rarity: Rare\nFoo")).toBeNull();
  });

  it("parses a rare ring with implicit, explicit and crafted mods", () => {
    const it = parseItem(
      txt(
        "Item Class: Rings",
        "Rarity: Rare",
        "Doom Spiral",
        "Two-Stone Ring",
        sep,
        "Requirements:",
        "Level: 63",
        sep,
        "Item Level: 84",
        sep,
        "+12% to Fire and Lightning Resistances (implicit)",
        sep,
        "+68 to maximum Life",
        "+40% to Cold Resistance",
        "Adds 3 to 7 Physical Damage to Attacks",
        "+17% to Chaos Resistance (crafted)",
        sep,
        "Searing Exarch Item",
      ),
    )!;
    expect(it).toMatchObject({
      itemClass: "Rings",
      rarity: "Rare",
      name: "Doom Spiral",
      baseType: "Two-Stone Ring",
      itemLevel: 84,
      influences: ["Searing Exarch"],
      corrupted: false,
    });
    expect(it.mods).toEqual([
      { text: "+12% to Fire and Lightning Resistances", kind: "implicit" },
      { text: "+68 to maximum Life", kind: "explicit" },
      { text: "+40% to Cold Resistance", kind: "explicit" },
      { text: "Adds 3 to 7 Physical Damage to Attacks", kind: "explicit" },
      { text: "+17% to Chaos Resistance", kind: "crafted" },
    ]);
  });

  it("strips Ctrl+Alt+C roll ranges and modifier headers", () => {
    const it = parseItem(
      txt(
        "Item Class: Belts",
        "Rarity: Rare",
        "Foo Clasp",
        "Leather Belt",
        sep,
        "Item Level: 80",
        sep,
        '{ Prefix Modifier "Virile" (Tier: 3) — Life }',
        "+80(80-89) to maximum Life",
      ),
    )!;
    expect(it.mods).toEqual([
      { text: "+80 to maximum Life", kind: "explicit", affix: "prefix", tier: 3, modName: "Virile", roll: 0 },
    ]);
  });

  it("reads tiers, rolls and open affixes from the advanced copy (Ctrl+Alt+C)", () => {
    const it = parseItem(
      txt(
        "Item Class: Rings",
        "Rarity: Rare",
        "Gale Loop",
        "Two-Stone Ring",
        sep,
        "Item Level: 84",
        sep,
        "{ Implicit Modifier — Elemental, Fire, Lightning, Resistance }",
        "+14(12-16)% to Fire and Lightning Resistances (implicit)",
        sep,
        '{ Prefix Modifier "Virile" (Tier: 3) — Life }',
        "+80(80-89) to maximum Life",
        '{ Suffix Modifier "of the Lightning" (Tier: 1) — Elemental, Lightning, Resistance }',
        "+48(46-48)% to Lightning Resistance",
        '{ Master Crafted Suffix Modifier "Upgraded" (Rank: 2) — Chaos, Resistance }',
        "+17(16-20)% to Chaos Resistance (crafted)",
      ),
    )!;
    expect(it.mods).toEqual([
      { text: "+14% to Fire and Lightning Resistances", kind: "implicit", roll: 0.5 },
      { text: "+80 to maximum Life", kind: "explicit", affix: "prefix", tier: 3, modName: "Virile", roll: 0 },
      { text: "+48% to Lightning Resistance", kind: "explicit", affix: "suffix", tier: 1, modName: "of the Lightning", roll: 1 },
      { text: "+17% to Chaos Resistance", kind: "crafted", affix: "suffix", rank: 2, modName: "Upgraded", roll: 0.25 },
    ]);
    expect(it.affixes).toEqual({ prefix: 1, suffix: 2, maxPrefix: 3, maxSuffix: 3 });
  });

  it("has no affix info with a plain Ctrl+C", () => {
    const it = parseItem(txt("Item Class: Rings", "Rarity: Rare", "A", "Ruby Ring", sep, "Item Level: 80", sep, "+80 to maximum Life"))!;
    expect(it.affixes).toBeNull();
    expect(it.mods[0].tier).toBeUndefined();
  });

  it("parses sockets, links, unique name and corruption", () => {
    const it = parseItem(
      txt(
        "Item Class: Body Armours",
        "Rarity: Unique",
        "Tabula Rasa",
        "Simple Robe",
        sep,
        "Sockets: W-W-W-W-W-W ",
        sep,
        "Item Level: 68",
        sep,
        "Item has no Attribute Requirements",
        sep,
        "Corrupted",
      ),
    )!;
    expect(it).toMatchObject({ name: "Tabula Rasa", baseType: "Simple Robe", links: 6, corrupted: true });
  });

  it("counts the biggest link group", () => {
    const it = parseItem(txt("Item Class: Gloves", "Rarity: Normal", "Superior Iron Gauntlets", sep, "Sockets: R-R G-B "))!;
    expect(it.links).toBe(2);
    expect(it.baseType).toBe("Iron Gauntlets");
  });

  it("parses gems", () => {
    const it = parseItem(
      txt(
        "Item Class: Skill Gems",
        "Rarity: Gem",
        "Cyclone",
        sep,
        "Attack, AoE, Movement, Channelling, Melee",
        "Level: 20 (Max)",
        "Quality: +20% (augmented)",
        sep,
        "Requirements:",
        "Level: 70",
        sep,
        "Corrupted",
      ),
    )!;
    expect(it).toMatchObject({ name: "Cyclone", baseType: "Cyclone", gemLevel: 20, quality: 20, corrupted: true });
  });

  it("parses stackable currency and divination cards", () => {
    const c = parseItem(txt("Item Class: Stackable Currency", "Rarity: Currency", "Chaos Orb", sep, "Stack Size: 1,234/5,000"))!;
    expect(c).toMatchObject({ name: "Chaos Orb", stackSize: 1234 });
    const d = parseItem(txt("Item Class: Divination Cards", "Rarity: Divination Card", "The Doctor", sep, "Stack Size: 3/8"))!;
    expect(d).toMatchObject({ name: "The Doctor", stackSize: 3 });
  });

  it("handles unidentified rares and map tiers", () => {
    const it = parseItem(
      txt("Item Class: Maps", "Rarity: Rare", "Crater Map", sep, "Map Tier: 16", sep, "Item Level: 83", sep, "Unidentified"),
    )!;
    expect(it).toMatchObject({ name: "", baseType: "Crater Map", mapTier: 16, unidentified: true, mods: [] });
  });
});
