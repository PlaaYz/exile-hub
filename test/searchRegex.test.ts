import { describe, expect, it } from "vitest";
import { MAP_MODS, atLeast, chromaticSearch, gemColors, kSearchMax, linkSearch, linkSearchCounts, mapSearch, movementSearch, uniqueFragment } from "../src/core/searchRegex";

describe("map search", () => {
  it("every mod gets a fragment unique to it", () => {
    for (const m of MAP_MODS) {
      const f = uniqueFragment(m);
      expect(f, m.id).toBeTruthy();
      expect(m.text.includes(f!)).toBe(true);
      for (const o of MAP_MODS) if (o.id !== m.id) expect(o.text.includes(f!), `${m.id} vs ${o.id}: ${f}`).toBe(false);
    }
  });

  it("builds a short exclusion + quantity search under 50 characters", () => {
    const s = mapSearch(["phys-reflect", "ele-reflect", "no-regen", "no-leech"], 70);
    expect(s.ok).toBe(true);
    expect(s.length).toBeLessThanOrEqual(kSearchMax);
    expect(s.text.startsWith('"!')).toBe(true);
    expect(s.parts).toHaveLength(5);
    // the quantity part matches real map lines
    const q = new RegExp(s.text.split(" ").pop()!.replace(/"/g, ""), "i");
    expect(q.test("Item Quantity: +72% (augmented)")).toBe(true);
    expect(q.test("Item Quantity: +100% (augmented)")).toBe(true);
    expect(q.test("Item Quantity: +69% (augmented)")).toBe(false);
  });

  it("exclusion fragments hit their mod line and nothing else on a real map", () => {
    const s = mapSearch(["phys-reflect", "no-regen"], null);
    const frags = s.text.replace(/^"!/, "").replace(/"$/, "").split("|");
    const re = new RegExp(frags.join("|"), "i");
    expect(re.test("Monsters reflect 18% of Physical Damage")).toBe(true);
    expect(re.test("Players cannot Regenerate Life, Mana or Energy Shield")).toBe(true);
    expect(re.test("Monsters reflect 18% of Elemental Damage")).toBe(false);
    expect(re.test("Item Quantity: +80% (augmented)")).toBe(false);
    expect(re.test("Monster Pack Size: +30% (augmented)")).toBe(false);
  });

  it("flags searches that do not fit", () => {
    const all = mapSearch(MAP_MODS.map((m) => m.id), 90);
    expect(all.ok).toBe(false);
    expect(all.length).toBeGreaterThan(kSearchMax);
  });
});

describe("number regex", () => {
  it.each([
    [70, [70, 75, 99, 100, 150], [69, 7, 60]],
    [65, [65, 69, 70, 99, 120], [64, 6, 50]],
    [90, [90, 99, 100], [89]],
    [99, [99, 100], [98]],
  ])("atLeast(%i)", (min, yes, no) => {
    const re = new RegExp(`^${atLeast(min)}$`);
    for (const v of yes) expect(re.test(String(v)), `${v}`).toBe(true);
    for (const v of no) expect(re.test(String(v)), `${v}`).toBe(false);
  });
});

describe("vendor searches", () => {
  it("links in the build's colors, white counting as any", () => {
    const s = linkSearch(["b", "b", "g"]);
    expect(s.ok).toBe(true);
    const re = new RegExp(s.text.replace(/"/g, ""), "i");
    expect(re.test("Sockets: B-B-G")).toBe(true);
    expect(re.test("Sockets: G-W-B")).toBe(true);
    expect(re.test("Sockets: B-G R")).toBe(false);
    expect(re.test("Sockets: R-R-R")).toBe(false);
  });

  it("falls back to any N-link when the colors do not fit", () => {
    const s = linkSearch(["r", "g", "b", "r"]);
    expect(s.ok).toBe(true);
    expect(s.text).toBe('"([rgbw]-){3}[rgbw]"');
  });

  it("gem colors from main attributes", () => {
    const attr: Record<string, string> = { Arc: "intelligence", "Added Lightning Damage Support": "intelligence", "Faster Casting Support": "intelligence", Frenzy: "dexterity" };
    expect(gemColors(["Arc", "Added Lightning Damage Support", "Frenzy", "Nope"], (n) => attr[n])).toEqual(["b", "b", "g"]);
  });

  it("movement speed boots", () => {
    const re = new RegExp(movementSearch().text.replace(/"/g, ""), "i");
    expect(re.test("10% increased Movement Speed")).toBe(true);
  });
});

describe("generic vendor link search", () => {
  it("any N-link when no color is asked", () => {
    expect(linkSearchCounts(4, 0, 0, 0).text).toBe('"([rgbw]-){3}[rgbw]"');
  });
  it("colors with free sockets, white counts as any", () => {
    const s = linkSearchCounts(3, 2, 0, 0);
    expect(s.ok).toBe(true);
    const re = new RegExp(s.text.slice(1, -1));
    expect(re.test("r-r-b")).toBe(true);
    expect(re.test("w-r-g")).toBe(true);
    expect(re.test("r-g-b")).toBe(false);
  });
  it("chromatic recipe fits and matches any order", () => {
    const s = chromaticSearch();
    expect(s.length).toBeLessThanOrEqual(kSearchMax);
    const re = new RegExp(s.text.slice(1, -1));
    expect(re.test("b-r-g")).toBe(true);
    expect(re.test("r-r-g")).toBe(false);
  });
});