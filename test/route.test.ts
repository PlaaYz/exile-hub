import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseRoute, type Lookups } from "../src/core/route";
import { RouteTracker } from "../src/core/tracker";
import { RunTimer } from "../src/core/timer";
import { stepText } from "../src/shared/render";

const data = path.resolve(__dirname, "../data");
const lk: Lookups = {
  areas: JSON.parse(fs.readFileSync(path.join(data, "json/areas.json"), "utf8")),
  quests: JSON.parse(fs.readFileSync(path.join(data, "json/quests.json"), "utf8")),
};
const act = (n: number) => fs.readFileSync(path.join(data, `routes/act-${n}.txt`), "utf8");

describe("parseRoute", () => {
  it("parses act 1 and resolves names", () => {
    const steps = parseRoute(act(1), lk, new Set(["LEAGUE_START"]));
    expect(steps.length).toBeGreaterThan(30);
    expect(steps[0].act).toBe(1);
    expect(stepText(steps[0])).toContain("Hillock");
    const town = steps.find((s) => s.arrival === "1_1_town");
    expect(town && stepText(town)).toBe("➞ Lioneye's Watch");
    const handIn = steps.find((s) => stepText(s).includes("Enemy at the Gate"));
    expect(handIn).toBeDefined();
  });

  it("honours #ifdef / #ifndef", () => {
    const withLeague = parseRoute(act(1), lk, new Set(["LEAGUE_START"]));
    const without = parseRoute(act(1), lk, new Set());
    const hasHailrake = (s: typeof withLeague) => s.some((x) => stepText(x).includes("Hailrake"));
    expect(hasHailrake(withLeague)).toBe(true);
    expect(hasHailrake(without)).toBe(false);
    expect(without.length).not.toBe(withLeague.length);
  });

  it("attaches #sub lines to the previous step", () => {
    const steps = parseRoute(act(1), lk, new Set(["LEAGUE_START"]));
    const glyph = steps.find((s) => stepText(s).includes("Glyph"));
    expect(glyph?.subs.length).toBeGreaterThan(0);
  });

  it("parses all 10 acts with no leftover braces or unknown fragments", () => {
    for (let n = 1; n <= 10; n++) {
      for (const defs of [new Set<string>(), new Set(["LEAGUE_START"])]) {
        const steps = parseRoute(act(n), lk, defs);
        expect(steps.length).toBeGreaterThan(5);
        for (const s of steps) {
          expect(s.act).toBe(n);
          const txt = stepText(s);
          expect(txt).not.toMatch(/[{}]/);
          for (const f of s.fragments) {
            if (f.kind === "enter" || f.kind === "area") {
              expect(lk.areas[f.areaId], `act ${n}: unknown area ${f.areaId}`).toBeDefined();
            }
            if (f.kind === "quest") {
              expect(lk.quests[f.ids[0]], `act ${n}: unknown quest ${f.ids[0]}`).toBeDefined();
            }
          }
        }
      }
    }
  });
});

describe("RouteTracker", () => {
  const steps = parseRoute(act(1), lk, new Set(["LEAGUE_START"]));

  it("starts at the first block, next is the first arrival", () => {
    const t = new RouteTracker(steps);
    const v = t.view();
    expect(v.block.length).toBeGreaterThan(0);
    expect(v.next?.arrival).toBe("1_1_town");
  });

  it("advances when the player enters the next area", () => {
    const t = new RouteTracker(steps);
    t.onArea("1_1_town");
    const v = t.view();
    expect(v.offRoute).toBe(false);
    expect(v.areaId).toBe("1_1_town");
    expect(v.block.some((s) => stepText(s).includes("Enemy at the Gate"))).toBe(true);
    expect(v.next?.arrival).toBe("1_1_2");
  });

  it("walks a whole act in order", () => {
    const t = new RouteTracker(steps);
    for (const s of steps) if (s.arrival) t.onArea(s.arrival);
    expect(t.offRoute).toBe(false);
    expect(t.view().cursor).toBeGreaterThan(steps.length - 5);
  });

  const isTown = (id: string) => lk.areas[id]?.is_town_area ?? false;

  it("a portal to town mid-route keeps the cursor (does not jump to a later town visit)", () => {
    const t = new RouteTracker(steps, isTown);
    t.onArea("1_1_town");
    t.onArea("1_1_2");
    t.onArea("1_1_3");
    const before = t.cursor;
    t.onArea("1_1_town"); // portal to town
    expect(t.cursor).toBe(before);
    expect(t.offRoute).toBe(false);
    t.onArea("1_1_3"); // portal back
    expect(t.cursor).toBe(before);
    expect(t.offRoute).toBe(false);
  });

  it("allows skipping one zone, and follows a far jump on its own", () => {
    const t = new RouteTracker(steps, isTown);
    t.onArea("1_1_2"); // skipped the town marker
    expect(t.offRoute).toBe(false);
    const far = new RouteTracker(steps, isTown);
    far.onArea("1_1_3");
    const atMudFlats = far.cursor;
    far.onArea("1_1_9"); // many markers ahead: jump there, no manual sync needed
    expect(far.offRoute).toBe(false);
    expect(far.view().areaId).toBe("1_1_9");
    expect(far.cursor).toBeGreaterThan(atMudFlats + 5);
    far.onArea("1_1_3"); // it was a detour: back to the Mud Flats rewinds
    expect(far.cursor).toBe(atMudFlats);
  });

  it("rewinds to an earlier non-town zone and flags unknown areas as off-route", () => {
    const t = new RouteTracker(steps, isTown);
    t.onArea("1_1_town");
    t.onArea("1_1_2");
    t.onArea("1_1_3");
    t.onArea("1_1_4_1");
    const before = t.cursor;
    // (not the Coast: the league-start route legitimately waypoints there next)
    t.onArea("1_1_3"); // walked back to the Mud Flats
    expect(t.cursor).toBeLessThan(before);
    expect(t.offRoute).toBe(false);
    const c = t.cursor;
    t.onArea("definitely_not_an_area");
    expect(t.offRoute).toBe(true);
    expect(t.cursor).toBe(c);
  });

  it("syncTo re-anchors on an area anywhere in the route", () => {
    const t = new RouteTracker(steps, isTown);
    expect(t.syncTo("1_1_3")).toBe(true);
    expect(t.offRoute).toBe(false);
    expect(t.view().next?.arrival).toBe("1_1_4_1");
    expect(t.syncTo("no_such_area")).toBe(false);
  });

  it("manual next/prev block move between markers", () => {
    const t = new RouteTracker(steps);
    t.nextBlock();
    const a = t.cursor;
    t.nextBlock();
    expect(t.cursor).toBeGreaterThan(a);
    t.prevBlock();
    expect(t.cursor).toBe(a);
    for (let i = 0; i < 200; i++) t.nextBlock();
    expect(t.view().done).toBe(true);
  });
});

describe("RunTimer", () => {
  it("accumulates per-act splits", () => {
    const t = new RunTimer();
    t.onArea(1, 1000);
    t.onArea(1, 5000);
    t.onArea(2, 11000);
    t.onArea(1, 12000); // back to act 1 via waypoint
    const s = t.snapshot(15000);
    expect(s.splits[1]).toBe(10000);
    expect(s.splits[2]).toBe(1000);
    expect(s.act).toBe(1);
    expect(s.actMs).toBe(13000);
    expect(s.runMs).toBe(14000);
  });
});
