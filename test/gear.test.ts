import { describe, expect, it } from "vitest";
import { parseItem } from "../src/core/item";
import { compareItem, gearSlotFor } from "../src/core/itemCompare";

const ring = (name: string, life: number) =>
  parseItem(`Item Class: Rings
Rarity: Rare
${name}
Amethyst Ring
--------
Item Level: 84
--------
+19% to Chaos Resistance (implicit)
--------
+${life} to maximum Life
+30% to Fire Resistance`)!;

const robe = (es: number) =>
  parseItem(`Item Class: Body Armours
Rarity: Rare
Grim Shell
Vaal Regalia
--------
Quality: +20% (augmented)
Energy Shield: ${es} (augmented)
--------
Item Level: 86
--------
+80 to maximum Energy Shield
+40% to Cold Resistance`)!;

const sword = (name: string, low: number, high: number) =>
  parseItem(`Item Class: One Hand Swords
Rarity: Rare
${name}
Jewelled Foil
--------
One Handed Sword
Quality: +20% (augmented)
Physical Damage: ${low}-${high} (augmented)
Critical Strike Chance: 5.50%
Attacks per Second: 1.60
--------
Item Level: 84
--------
+25% to Global Critical Strike Multiplier (implicit)
--------
120% increased Physical Damage`)!;

describe("register my equipment", () => {
  it("puts the first ring in Ring 1, the second in Ring 2, a second one-hander in the off hand", () => {
    const taken = new Set<string>();
    const first = gearSlotFor(ring("A", 50), taken)!;
    taken.add(first);
    const second = gearSlotFor(ring("B", 60), taken)!;
    expect([first, second]).toEqual(["Ring 1", "Ring 2"]);
    taken.add(second);
    // a third ring in the same registration replaces Ring 1
    expect(gearSlotFor(ring("C", 70), taken)).toBe("Ring 1");
    const w1 = gearSlotFor(sword("S1", 50, 100), taken)!;
    taken.add(w1);
    expect([w1, gearSlotFor(sword("S2", 60, 110), taken)]).toEqual(["Weapon 1", "Weapon 2"]);
    expect(gearSlotFor(robe(500), new Set())).toBe("Body Armour");
    const flask = parseItem("Item Class: Life Flasks\nRarity: Normal\nDivine Life Flask\n--------\nItem Level: 80")!;
    expect(gearSlotFor(flask, new Set())).toBeNull();
  });

  it("items registered from the game also compare DPS and defences", () => {
    const es = compareItem(robe(600), [{ slot: "Body Armour", item: robe(500), fromGame: true }])[0];
    expect(es.fromGame).toBe(true);
    expect(es.rows.find((r) => /Energy Shield \(Q20\)/.test(r.label))).toMatchObject({ equipped: 500, candidate: 600 });
    const dps = compareItem(sword("New", 60, 120), [{ slot: "Weapon 1", item: sword("Old", 50, 100), fromGame: true }])[0];
    expect(dps.rows.find((r) => /DPS físico/.test(r.label))).toMatchObject({ equipped: 120, candidate: 144 });
  });
});

describe("reading copied items", () => {
  it("leaves out reminder text and a unique's flavour text", () => {
    const item = parseItem(`Item Class: Amulets
Rarity: Unique
Test Loop
Onyx Amulet
--------
Requirements:
Level: 60
--------
Item Level: 84
--------
+12 to all Attributes (implicit)
--------
Adds 1 to 4 Physical Damage to Attacks
(Attributes are Strength, Dexterity, and Intelligence)
28% increased Global Defences
(Armour, Evasion Rating and Energy Shield are the standard
Defences)
Reflects opposite Ring
--------
Existence is infinite
A weave of the living and dead
--------
Corrupted`)!;
    expect(item.mods.map((m) => m.text)).toEqual([
      "+12 to all Attributes",
      "Adds 1 to 4 Physical Damage to Attacks",
      "28% increased Global Defences",
      "Reflects opposite Ring",
    ]);
    expect(item.corrupted).toBe(true);
  });
});

describe("comparison totals", () => {
  const amulet = (lines: string) =>
    parseItem(`Item Class: Amulets\nRarity: Rare\nX\nOnyx Amulet\n--------\nItem Level: 84\n--------\n${lines}`)!;

  it("shows chaos resistance on its own and all attributes as one row", () => {
    const [c] = compareItem(amulet("+16 to all Attributes\n+30% to Chaos Resistance\n+40% to Fire Resistance"), [
      { slot: "Amulet", item: amulet("+25 to all Attributes\n+50% to Cold Resistance"), fromGame: true },
    ]);
    const row = (re: RegExp) => c.rows.find((r) => re.test(r.label));
    expect(row(/Chaos Resistance/)).toMatchObject({ equipped: 0, candidate: 30 });
    expect(row(/Elemental Resistance/)).toMatchObject({ equipped: 50, candidate: 40 });
    expect(row(/all Attributes/)).toMatchObject({ equipped: 25, candidate: 16 });
    expect(row(/Strength/)).toBeUndefined();
  });

  it("names the attribute when they differ", () => {
    const [c] = compareItem(amulet("+30 to Strength"), [{ slot: "Amulet", item: amulet("+25 to all Attributes"), fromGame: true }]);
    expect(c.rows.find((r) => /Strength/.test(r.label))).toMatchObject({ equipped: 25, candidate: 30 });
    expect(c.rows.find((r) => /Dexterity/.test(r.label))).toMatchObject({ equipped: 25, candidate: 0 });
  });
});
