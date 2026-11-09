import { describe, expect, it } from "vitest";
import { parseLine } from "../src/core/clientLog";
import {
  PassiveTracker,
  compareTree,
  isCharacterPassiveId,
  kMaxPointsWithoutLevel,
  pointBudget,
  pointsIn,
  slimTree,
} from "../src/core/passives";
import type { PobBuild } from "../src/shared/types";

// start(1) - a(2) - b(3) - NotableX(4) - c(5) - KeystoneY(6);  b - d(7) - NotableZ(8)
const raw = {
  classes: [{ name: "Witch" }],
  nodes: {
    "1": { skill: 1, name: "WITCH", classStartIndex: 0, out: ["2"] },
    "2": { skill: 2, name: "Intelligence", out: ["3"] },
    "3": { skill: 3, name: "Intelligence", out: ["4", "7"] },
    "4": { skill: 4, name: "Notable X", isNotable: true, out: ["5"], stats: ["+10 to X"] },
    "5": { skill: 5, name: "Life", out: ["6"] },
    "6": { skill: 6, name: "Keystone Y", isKeystone: true },
    "7": { skill: 7, name: "Life", out: ["8"] },
    "8": { skill: 8, name: "Notable Z", isNotable: true },
    "9": { skill: 9, name: "Asc Notable", isNotable: true, ascendancyName: "Elementalist" },
    "10": { skill: 10, name: "Other Notable", isNotable: true },
    "11": { skill: 11, name: "Some Mastery", isMastery: true },
  },
};
const tree = slimTree(raw, "test");
const build = (ids: number[]): PobBuild => ({ className: "Witch", ascendClass: "Elementalist", level: 90, groups: [], treeNodes: ids });

const line = (pid: number, s: string) => `2026/11/08 12:00:00 1 a [INFO Client ${pid}] ${s}`;
const alloc = (pid: number, id: string, name: string, on = true) =>
  line(pid, `Successfully ${on ? "allocated" : "unallocated"} passive skill id: ${id}, name: ${name}`);
const lvl = (pid: number, who: string, n: number) => line(pid, `: ${who} (Witch) is now level ${n}`);

function feed(t: PassiveTracker, lines: string[]) {
  for (const l of lines) {
    const ev = parseLine(l);
    if (ev) t.feed(ev);
  }
}

describe("tree data", () => {
  it("slims the export, links both ways and finds class starts", () => {
    expect(tree.classStarts).toEqual({ Witch: 1 });
    expect(tree.nodes[2].links.sort()).toEqual([1, 3]);
    expect(tree.nodes[11].mastery).toBe(true);
  });

  it("places nodes on their group's orbit like Path of Building", () => {
    const t = slimTree(
      {
        nodes: {
          "1": { skill: 1, name: "Centre", group: 1, orbit: 0, orbitIndex: 0 },
          "2": { skill: 2, name: "East", group: 1, orbit: 2, orbitIndex: 4 }, // 16 slots: index 4 = 90°
        },
        groups: { "1": { x: 100, y: 200 } },
        constants: { skillsPerOrbit: [1, 6, 16, 16, 40], orbitRadii: [0, 82, 162, 335, 493] },
      },
      "t",
    );
    expect([t.nodes[1].x, t.nodes[1].y]).toEqual([100, 200]);
    expect([t.nodes[2].x, t.nodes[2].y]).toEqual([262, 200]);
  });
});

describe("PassiveTracker", () => {
  it("parses passive lines and skips other trees", () => {
    expect(parseLine(alloc(7, "life_armour_evasion_notable1853", "Bravery"))).toMatchObject({
      type: "passive",
      allocated: true,
      skillId: "life_armour_evasion_notable1853",
      name: "Bravery",
      pid: 7,
    });
    expect(isCharacterPassiveId("intelligence956")).toBe(true);
    expect(isCharacterPassiveId("atlas_path_23_")).toBe(false);
    expect(isCharacterPassiveId("CurrencyNode3d")).toBe(false);
  });

  it("attributes points to the character leveling in the same game session", () => {
    const t = new PassiveTracker();
    feed(t, [
      alloc(1, "int1", "Intelligence"), // before any level-up in this session: pending
      lvl(1, "Ana", 5),
      alloc(1, "int2", "Intelligence"),
      alloc(1, "int2", "Intelligence", false), // refunded
      alloc(1, "atlas_path_1", "Map Drop Chance"),
      alloc(2, "life1", "Life"), // new game session, character unknown...
      lvl(2, "Bia", 3), // ...it was Bia
    ]);
    expect([...t.allocated("Ana")]).toEqual([["Intelligence", 1]]);
    expect([...t.allocated("Bia")]).toEqual([["Life", 1]]);
  });

  it("stops attributing when too many points appear without a level-up", () => {
    const t = new PassiveTracker();
    const many = Array.from({ length: kMaxPointsWithoutLevel + 5 }, (_, i) => alloc(1, `life${i}`, "Life"));
    feed(t, [lvl(1, "Ana", 10), ...many, lvl(1, "Ana", 11), alloc(1, "int1", "Intelligence")]);
    expect(pointsIn(t.allocated("Ana"))).toBe(kMaxPointsWithoutLevel + 1);
  });

  it("forgets a deleted character whose name comes back at level 2", () => {
    const t = new PassiveTracker();
    feed(t, [lvl(1, "Ana", 40), alloc(1, "int1", "Intelligence"), lvl(2, "Ana", 2)]);
    expect(pointsIn(t.allocated("Ana"))).toBe(0);
  });

  it("point budget", () => {
    expect(pointBudget(1)).toBe(32);
    expect(pointBudget(90)).toBe(121);
  });
});

describe("compareTree", () => {
  const b = build([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);

  it("counts build points, matches names and orders missing notables by distance", () => {
    const p = compareTree(tree, b, new Map([["Intelligence", 2], ["Other Notable", 1]]));
    expect(p.buildPoints).toBe(7); // 2..8 (no start, no mastery, no ascendancy)
    expect(p.donePoints).toBe(2);
    expect(p.missing.map((m) => [m.name, m.distance])).toEqual([
      ["Notable X", 1],
      ["Notable Z", 2],
      ["Keystone Y", 3],
    ]);
    expect(p.ascMissing).toEqual(["Asc Notable"]);
    expect(p.offBuild).toEqual(["Other Notable"]);
  });

  it("starts from the class start when nothing is allocated", () => {
    const p = compareTree(tree, b, new Map());
    expect(p.missing[0]).toMatchObject({ name: "Notable X", distance: 3 });
  });

  it("next path: to the nearest notable, then on to the following ones", () => {
    const p = compareTree(tree, b, new Map([["Intelligence", 2]]));
    // has 2,3 -> Notable X (4), then Life 5 -> Keystone Y (6) or Life 7 -> Notable Z (8): nearest first
    expect(p.nextPath[0]).toBe(4);
    expect(new Set(p.nextPath)).toEqual(new Set([4, 5, 6, 7, 8]));
    expect(p.nextPath.indexOf(5)).toBeLessThan(p.nextPath.indexOf(6));
    expect(p.nextPath.indexOf(7)).toBeLessThan(p.nextPath.indexOf(8));
    expect(p.haveIds.sort()).toEqual([2, 3]);
    expect(p.startId).toBe(1);
  });

  it("small nodes are matched by count", () => {
    const p = compareTree(tree, b, new Map([["Life", 1], ["Notable X", 1], ["Intelligence", 2]]));
    expect(p.donePoints).toBe(4);
    expect(p.missing.map((m) => m.name)).toEqual(["Keystone Y", "Notable Z"]);
  });
});
