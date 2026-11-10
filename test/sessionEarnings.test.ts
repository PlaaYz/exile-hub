import { describe, expect, it } from "vitest";
import { farmIdOf } from "../src/core/bossRuns";
import { sessionEarnings, type FarmPrice } from "../src/core/farm";
import { GameSessionTracker } from "../src/core/gameSessions";
import { FARM_BOSSES } from "../src/shared/farmData";

const area = (areaId: string, areaLevel: number, seed: number, ts: number) => ({ type: "area" as const, areaId, areaLevel, seed, ts });

describe("session earnings", () => {
  it("knows boss arenas (normal / uber by level) and T17 maps", () => {
    expect(farmIdOf("AtlasExilesBoss5", 83)).toBe("sirus");
    expect(farmIdOf("AtlasExilesBoss5", 85)).toBe("uber-sirus");
    expect(farmIdOf("MapWorldsZiggurat", 83)).toBe("t17-ziggurat");
    expect(farmIdOf("MapWorldsStrand", 83)).toBeNull();
  });

  it("a session counts each fresh boss/T17 instance once (portals back in do not count)", () => {
    const t = new GameSessionTracker(() => null);
    t.feed({ type: "focus", focused: true, opening: true, ts: 1000 } as never);
    t.feed(area("MapWorldsZiggurat", 83, 7, 2000));
    t.feed(area("HideoutFelled", 68, 1, 3000));
    t.feed(area("MapWorldsZiggurat", 83, 7, 4000)); // back through the portal
    t.feed(area("MapWorldsZiggurat", 83, 8, 5000));
    t.feed(area("MapWorldsPrimordialBoss2", 79, 9, 6000));
    expect(t.current!.kills).toEqual({ "t17-ziggurat": 2, "black-star": 1 });
  });

  it("adds the farm tab's expected profit per kill", () => {
    const zig = FARM_BOSSES.find((b) => b.id === "t17-ziggurat")!;
    // every Ziggurat drop at 10c, map 50c: (1+1 fragments + 0.1 from the pool) * 10 - 50
    const prices = new Map<string, FarmPrice>(zig.drops.map((d) => [d.name, { chaos: 10 }]));
    const e = sessionEarnings({ "t17-ziggurat": 3, nope: 2 }, FARM_BOSSES, prices)!;
    expect(e.lines).toEqual([{ id: "t17-ziggurat", name: "Ziggurat (T17)", count: 3, each: expect.closeTo(-29, 5) }]);
    expect(e.chaos).toBeCloseTo(-87, 5);
    expect(e.incomplete).toBe(false);
    expect(sessionEarnings({}, FARM_BOSSES, prices)).toBeNull();
  });
});
