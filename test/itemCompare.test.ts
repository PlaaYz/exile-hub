import { describe, expect, it } from "vitest";
import { parseItem } from "../src/core/item";
import { compareItem, parsePobEquipped, parsePobItem, slotsFor } from "../src/core/itemCompare";

const POB_XML = `<PathOfBuilding>
<Items activeItemSet="2">
<Item id="1">
			Rarity: RARE
Doom Knuckle
Vaal Gauntlets
Unique ID: abc
Item Level: 84
Quality: 20
Sockets: R-R-R-G
LevelReq: 63
Implicits: 0
+70 to maximum Life
{range:0.5}+(30-40)% to Fire Resistance
{crafted}+15% to Cold Resistance
+20 to Strength
Adds 5 to 10 Physical Damage to Attacks
</Item>
<Item id="2">
			Rarity: RARE
Old Grip
Iron Gauntlets
Implicits: 0
+10 to maximum Life
</Item>
<Item id="3">
			Rarity: UNIQUE
Kaom's Heart
Glorious Plate
Selected Variant: 2
Implicits: 0
{variant:1}+500 to maximum Life
{variant:2}+1000 to maximum Life
Has no Sockets
</Item>
<ItemSet id="1"><Slot name="Gloves" itemId="2"/></ItemSet>
<ItemSet id="2"><Slot name="Gloves" itemId="1"/><Slot name="Body Armour" itemId="3"/><Slot name="Flask 1" itemId="2"/></ItemSet>
</Items>
</PathOfBuilding>`;

const gloves = `Item Class: Gloves
Rarity: Rare
Grim Grasp
Vaal Gauntlets
--------
Item Level: 85
--------
+90 to maximum Life
+40% to Fire Resistance
+30% to Lightning Resistance
+12% increased Attack Speed
`;

describe("compare with my item", () => {
  it("reads the active item set of a PoB export", () => {
    const eq = parsePobEquipped(POB_XML);
    expect(eq.map((e) => e.slot)).toEqual(["Gloves", "Body Armour"]);
    expect(eq[0].item.name).toBe("Doom Knuckle");
    expect(eq[0].item.mods.map((m) => m.text)).toContain("+35% to Fire Resistance");
    expect(eq[0].item.mods.find((m) => m.text === "+15% to Cold Resistance")?.kind).toBe("crafted");
  });

  it("keeps only the selected variant of a unique", () => {
    const body = parsePobEquipped(POB_XML).find((e) => e.slot === "Body Armour")!.item;
    expect(body.mods.map((m) => m.text)).toEqual(["+1000 to maximum Life", "Has no Sockets"]);
  });

  it("an item without the Implicits line is not read", () => {
    expect(parsePobItem("Rarity: RARE\nX\nY\n+10 to maximum Life", "Gloves")).toBeNull();
  });

  it("totals and lines against the equipped item", () => {
    const [c] = compareItem(parseItem(gloves)!, parsePobEquipped(POB_XML));
    expect(c.slot).toBe("Gloves");
    expect(c.name).toBe("Doom Knuckle");
    const life = c.rows.find((r) => /total maximum Life/.test(r.label))!;
    expect(life.candidate).toBeGreaterThan(life.equipped - 1); // 90 vs 70 + 20 str / 2 = 80
    expect(life.candidate - life.equipped).toBe(10);
    expect(c.onlyCandidate).toContain("+12% increased Attack Speed");
    expect(c.onlyEquipped).toContain("Adds 5 to 10 Physical Damage to Attacks");
  });

  it("rings compare with both rings; jewels with nothing", () => {
    expect(slotsFor("Rings")).toEqual(["Ring 1", "Ring 2", "Ring 3"]);
    expect(slotsFor("Two Hand Swords")).toEqual(["Weapon 1"]);
    expect(slotsFor("Jewels")).toEqual([]);
  });
});
