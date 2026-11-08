import { describe, expect, it } from "vitest";
import { ARENAS, BossRunTracker, measuredMinutes } from "../src/core/bossRuns";
import { parseLine } from "../src/core/clientLog";
import { FARM_BOSSES } from "../src/shared/farmData";

const gen = (t: string, id: string, level: number, seed: number) =>
  `2026/11/08 ${t} 1 a [DEBUG Client 1] Generating level ${level} area "${id}" with seed ${seed}`;
const entered = (t: string, name: string) => `2026/11/08 ${t} 1 a [INFO Client 1] : You have entered ${name}.`;
const slain = (t: string) => `2026/11/08 ${t} 1 a [INFO Client 1] : Foo has been slain.`;

function run(lines: string[]): BossRunTracker {
  const tr = new BossRunTracker();
  for (const l of lines) {
    const ev = parseLine(l);
    if (ev) tr.feed(ev);
  }
  return tr;
}

describe("BossRunTracker", () => {
  it("every arena points at a boss of the farm tables", () => {
    const ids = new Set(FARM_BOSSES.map((b) => b.id));
    for (const a of ARENAS) {
      expect(ids.has(a.boss), a.boss).toBe(true);
      if (a.uber) expect(ids.has(a.uber), a.uber).toBe(true);
    }
  });

  it("counts a run from entering to leaving, merging re-entries of the same instance", () => {
    const tr = run([
      gen("12:00:00", "HideoutCourts", 60, 1),
      gen("12:01:00", "MavenBoss", 84, 777),
      slain("12:02:00"),
      gen("12:02:10", "HideoutCourts", 60, 1), // died, back to hideout
      gen("12:02:40", "MavenBoss", 84, 777), // same instance through the portal
      gen("12:05:00", "HideoutCourts", 60, 1),
    ]);
    expect(tr.runs).toHaveLength(1);
    expect(tr.runs[0]).toMatchObject({ boss: "maven", deaths: 1, level: 84 });
    expect((tr.runs[0].end! - tr.runs[0].start) / 1000).toBe(240);
  });

  it("tells uber fights apart by area level and measures back-to-back cycles", () => {
    const tr = run([
      gen("12:00:00", "MapWorldsPrimordialBoss4", 85, 1),
      gen("12:03:00", "HideoutCourts", 60, 1),
      gen("12:06:00", "MapWorldsPrimordialBoss4", 85, 2),
      gen("12:08:00", "HideoutCourts", 60, 1),
      gen("13:30:00", "MapWorldsPrimordialBoss4", 85, 3), // next day of farming: not a cycle
      gen("13:32:00", "HideoutCourts", 60, 1),
      gen("14:00:00", "MapWorldsPrimordialBoss4", 83, 4), // normal Eater
    ]);
    const s = tr.stats();
    expect(s.get("uber-eater")).toMatchObject({ runs: 3, cycleSec: 360, fightSec: 120 });
    expect(measuredMinutes(s.get("uber-eater"))).toBe(6);
    expect(s.get("eater")).toMatchObject({ runs: 1, fightSec: null }); // still inside
    expect(measuredMinutes(s.get("eater"))).toBeNull();
  });

  it("matches arenas known only by name through 'You have entered'", () => {
    const tr = run([gen("12:00:00", "SomethingNew", 85, 9), entered("12:00:01", "Cortex"), gen("12:04:00", "HideoutCourts", 60, 1)]);
    expect(tr.runs).toHaveLength(1);
    expect(tr.runs[0].boss).toBe("uber-venarius");
    expect(measuredMinutes(tr.stats().get("uber-venarius"))).toBe(5); // 4 min fight + 1 min overhead
  });

  it("ignores deaths outside arenas", () => {
    const tr = run([gen("12:00:00", "MapWorldsStrand", 83, 1), slain("12:01:00")]);
    expect(tr.runs).toHaveLength(0);
  });
});
