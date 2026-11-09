import { describe, expect, it } from "vitest";
import { parseItem } from "../src/core/item";
import { defences, pseudoStats, weaponDps } from "../src/core/itemCalc";
import { buildQuery, coveredByCalc, defaultFilters } from "../src/core/trade";

const sep = "--------";
const txt = (...p: string[]) => p.join("\n");

const axe = txt(
  "Item Class: Two Hand Axes",
  "Rarity: Rare",
  "Dread Edge",
  "Vaal Axe",
  sep,
  "Two Hand Axe",
  "Quality: +10% (augmented)",
  "Physical Damage: 200-300 (augmented)",
  "Elemental Damage: 10-20 (augmented), 30-40 (augmented)",
  "Critical Strike Chance: 5.00%",
  "Attacks per Second: 1.50 (augmented)",
  sep,
  "Item Level: 84",
  sep,
  "150% increased Physical Damage",
  "Adds 10 to 20 Fire Damage",
  "10% increased Attack Speed",
);

const chest = txt(
  "Item Class: Body Armours",
  "Rarity: Rare",
  "Grim Shell",
  "Astral Plate",
  sep,
  "Quality: +0%",
  "Armour: 1000 (augmented)",
  "Energy Shield: 200 (augmented)",
  sep,
  "Item Level: 86",
  sep,
  "100% increased Armour and Energy Shield",
  "+90 to maximum Life",
  "+40 to Strength",
  "+30% to all Elemental Resistances",
  "+20% to Chaos Resistance",
);

describe("item calculations", () => {
  it("weapon DPS now and at 20% quality (only physical scales)", () => {
    const d = weaponDps(parseItem(axe)!)!;
    expect(d.pdps).toBe(375); // 250 * 1.5
    expect(d.edps).toBe(75); // (15 + 35) * 1.5
    expect(d.dps).toBe(450);
    expect(d.pdpsQ20).toBe(389.4); // 375 * (100+150+20)/(100+150+10)
  });

  it("defences at 20% quality with local hybrid increases", () => {
    const d = defences(parseItem(chest)!)!;
    expect(d).toMatchObject({ armour: 1000, es: 200, evasion: null });
    expect(d.armourQ20).toBe(1100); // 1000 * (100+100+20)/(100+100+0)
    expect(d.esQ20).toBe(220);
  });

  it("pseudo totals like the trade site: resistances, life with strength/2, attributes", () => {
    const p = Object.fromEntries(pseudoStats(parseItem(chest)!).map((s) => [s.statId, s.value]));
    expect(p["pseudo.pseudo_total_elemental_resistance"]).toBe(90);
    expect(p["pseudo.pseudo_total_resistance"]).toBe(110);
    expect(p["pseudo.pseudo_total_life"]).toBe(110); // 90 + 40/2
    expect(p["pseudo.pseudo_total_strength"]).toBe(40);
    // flat ES on armour is its property, not a pseudo total
    expect(p["pseudo.pseudo_total_energy_shield"]).toBeUndefined();
  });

  it("rare weapons search by pDPS, armour by its defences; the local lines are covered", () => {
    const item = parseItem(axe)!;
    const f = defaultFilters(item, weaponDps(item), defences(item));
    expect(f.pdps).toEqual({ enabled: true, min: 337, max: null });
    expect(f.edps?.enabled).toBe(false);
    expect(coveredByCalc("150% increased Physical Damage", f)).toBe(true);
    expect(coveredByCalc("Adds 10 to 20 Fire Damage", f)).toBe(true);
    expect(coveredByCalc("+90 to maximum Life", f)).toBe(false);
    const q = buildQuery(item, [], f) as any;
    expect(q.query.filters.weapon_filters.filters).toEqual({ pdps: { min: 337 } });

    const c = parseItem(chest)!;
    const fc = defaultFilters(c, weaponDps(c), defences(c));
    expect(fc.armour).toEqual({ enabled: true, min: 900, max: null });
    expect(fc.es).toEqual({ enabled: true, min: 180, max: null });
    expect(coveredByCalc("100% increased Armour and Energy Shield", fc)).toBe(true);
  });

  it("filters the player turns on/off reach the query", () => {
    const item = parseItem(chest)!;
    const f = { ...defaultFilters(item, null, defences(item)), online: false, baseType: true, itemLevel: { enabled: true, min: 84, max: null } };
    const q = buildQuery(item, [], f) as any;
    expect(q.query.status).toEqual({ option: "any" });
    expect(q.query.type).toBe("Astral Plate");
    expect(q.query.filters.misc_filters.filters.ilvl).toEqual({ min: 84 });
    expect(q.query.filters.type_filters.filters.category).toBeUndefined();
  });
});
