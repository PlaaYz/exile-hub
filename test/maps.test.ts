import { describe, expect, it } from "vitest";
import { parseLine } from "../src/core/clientLog";
import { MapTracker, isMapArea, mapTier } from "../src/core/maps";

const at = (t: string) => new Date(`2026-11-08T${t}`).getTime();
const gen = (t: string, id: string, level: number, seed: number) =>
  `2026/11/08 ${t} 1 a [DEBUG Client 1] Generating level ${level} area "${id}" with seed ${seed}`;
const entered = (t: string, name: string) => `2026/11/08 ${t} 1 a [INFO Client 1] : You have entered ${name}.`;
const slain = (t: string) => `2026/11/08 ${t} 1 a [INFO Client 1] : Foo has been slain.`;
const closing = (t: string) => `2026/11/08 ${t} 1 a [INFO Client 1] Closing game gracefully`;

function run(lines: string[]): MapTracker {
  const m = new MapTracker();
  for (const l of lines) {
    const ev = parseLine(l);
    if (ev) m.feed(ev);
  }
  return m;
}

describe("map classification", () => {
  it("keeps boss arenas out and computes tiers", () => {
    expect(isMapArea("MapWorldsStrand")).toBe(true);
    expect(isMapArea("MapWorldsPrimordialBoss3")).toBe(false);
    expect(isMapArea("MapWorldsShapersRealm")).toBe(false);
    expect(isMapArea("MapWorldsMemoryBoss1")).toBe(false);
    expect(isMapArea("HideoutCourts")).toBe(false);
    expect(mapTier(68)).toBe(1);
    expect(mapTier(83)).toBe(16);
  });
});

describe("MapTracker", () => {
  it("one map with a portal trip and a sub-area: time inside only, deaths counted", () => {
    const m = run([
      gen("12:00:00", "HideoutCourts", 60, 1),
      gen("12:01:00", "MapWorldsStrand", 83, 500),
      entered("12:01:01", "Strand"),
      slain("12:02:00"),
      gen("12:03:00", "HideoutCourts", 60, 1), // 2 min inside
      gen("12:04:00", "MapWorldsStrand", 83, 500), // back through the portal (1 min in hideout)
      gen("12:05:00", "AbyssLeagueBoss2", 83, 77), // sub-area opened inside the map
      gen("12:06:30", "MapWorldsStrand", 83, 500),
      gen("12:07:00", "HideoutCourts", 60, 1), // 3 min more inside
    ]);
    expect(m.runs).toHaveLength(1);
    expect(m.runs[0]).toMatchObject({ name: "Strand", level: 83, deaths: 1, inMapMs: 5 * 60_000 });
    const s = m.stats(at("12:08:00"));
    expect(s.current).toMatchObject({ name: "Strand", tier: 16, inside: false, inMapMs: 5 * 60_000 });
    expect(s.session).toMatchObject({ maps: 1, deaths: 1, inMapMs: 5 * 60_000 });
  });

  it("a new seed is a new map; sessions split on long gaps; maps per hour", () => {
    const lines: string[] = [];
    // 6 maps, one every 5 minutes, 4 minutes inside each
    for (let i = 0; i < 6; i++) {
      const mm = String(i * 5).padStart(2, "0");
      const out = String(i * 5 + 4).padStart(2, "0");
      lines.push(gen(`13:${mm}:00`, "MapWorldsBeach", 83, 100 + i), gen(`13:${out}:00`, "HideoutCourts", 60, 1));
    }
    lines.unshift(gen("09:00:00", "MapWorldsDunes", 80, 9), gen("09:10:00", "HideoutCourts", 60, 1)); // morning
    const m = run(lines);
    expect(m.runs).toHaveLength(7);
    const s = m.stats(at("13:30:00"));
    expect(s.session).toMatchObject({ maps: 6, inMapMs: 24 * 60_000, ms: 29 * 60_000 });
    expect(s.session!.mapsPerHour).toBeCloseTo((6 * 60) / 29);
    expect(s.session!.avgMapMs).toBe(4 * 60_000);
    expect(s.today?.maps).toBe(7);
    // two sessions today: 10 min in the morning + 29 min now, not 09:00 -> 13:29
    expect(s.today?.ms).toBe(39 * 60_000);
    expect(s.byMap[0]).toMatchObject({ name: "MapWorldsBeach".replace("MapWorlds", ""), count: 6 });
    expect(s.recent[0].name).toBe("Beach");
  });

  it("the live timer runs while inside and the session ends after a long break", () => {
    const m = run([gen("14:00:00", "MapWorldsStrand", 83, 1)]);
    expect(m.stats(at("14:02:30")).current).toMatchObject({ inside: true, inMapMs: 150_000 });
    expect(m.stats(at("16:00:00")).current?.inside).toBe(true); // still inside as far as the log knows
    const m2 = run([gen("14:00:00", "MapWorldsStrand", 83, 1), gen("14:03:00", "HideoutCourts", 60, 1)]);
    expect(m2.stats(at("15:00:00")).current).toBeNull();
    expect(m2.stats(at("15:00:00")).session).toBeNull();
  });

  it("records league mechanics met inside a map, once each, and their share", () => {
    const npc = (t: string, who: string) => `2026/11/08 ${t} 1 a [INFO Client 1] ${who}: Exile!`;
    const m = run([
      npc("16:59:00", "Einhar, Beastmaster"), // in town: ignored
      gen("17:00:00", "MapWorldsStrand", 83, 1),
      npc("17:00:30", "Niko, Master of the Depths"),
      npc("17:01:00", "Niko, Master of the Depths"),
      npc("17:01:30", "Einhar, Beastmaster"),
      gen("17:03:00", "HideoutCourts", 60, 1),
      npc("17:03:10", "Sister Cassia"), // hideout between maps: ignored
      gen("17:04:00", "MapWorldsBeach", 83, 2),
      npc("17:04:30", "Niko, Master of the Depths"),
      npc("17:04:40", "#Troll: Niko, Master of the Depths: fake"), // chat: not an NPC
      gen("17:06:00", "HideoutCourts", 60, 1),
    ]);
    expect(m.runs.map((r) => r.mechanics)).toEqual([["Delve (Niko)", "Bestiary (Einhar)"], ["Delve (Niko)"]]);
    const s = m.stats(at("17:07:00"));
    expect(s.mechanics[0]).toEqual({ name: "Delve (Niko)", maps: 2, share: 1 });
    expect(s.recent[0].mechanics).toEqual(["Delve (Niko)"]);
    expect(s.current?.mechanics).toEqual(["Delve (Niko)"]);
  });

  it("closing the game inside a map stops the clock", () => {
    const m = run([
      gen("15:00:00", "MapWorldsStrand", 83, 1),
      closing("15:02:00"),
      gen("20:00:00", "HideoutCourts", 60, 1), // next evening
    ]);
    expect(m.runs[0].inMapMs).toBe(2 * 60_000);
  });

  it("campaign or lab entered from the hideout is not part of the previous map", () => {
    const m = run([
      gen("16:00:00", "MapWorldsStrand", 83, 1),
      gen("16:02:00", "HideoutCourts", 60, 1),
      gen("16:03:00", "Labyrinth_Airlock", 75, 2),
      gen("16:20:00", "HideoutCourts", 60, 1),
    ]);
    expect(m.runs[0].inMapMs).toBe(2 * 60_000);
  });
});
