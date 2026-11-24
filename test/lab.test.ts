import { describe, expect, it } from "vitest";
import { parseLine } from "../src/core/clientLog";
import { LabTracker, labRoomName } from "../src/core/lab";

const gen = (t: string, id: string, level: number, seed: number) =>
  `2026/11/19 ${t} 1 a [DEBUG Client 1] Generating level ${level} area "${id}" with seed ${seed}`;
const slain = (t: string) => `2026/11/19 ${t} 1 a [INFO Client 1] : Foo has been slain.`;
const at = (t: string) => new Date(`2026-11-19T${t}`).getTime();
const R = (t: string, room: string, seed: number) => gen(t, `EndGame_Labyrinth_${room}`, 75, seed);

function run(lines: string[]): LabTracker {
  const l = new LabTracker();
  for (const x of lines) {
    const ev = parseLine(x);
    if (ev) l.feed(ev);
  }
  return l;
}

// the owner's run, with a detour (C_end) and back
const full = [
  gen("12:30:55", "Labyrinth_Airlock", 33, 1),
  R("12:31:09", "OH_branch", 10),
  R("12:31:31", "DG_quad_door", 11),
  R("12:32:54", "C_end_bottleneck", 12),
  R("12:34:20", "DG_quad_door", 11),
  R("12:34:40", "boss_1", 13),
  R("12:35:17", "OH_straight_bottleneck", 14),
  R("12:37:46", "boss_1", 15),
  R("12:38:15", "DG_branch_bottleneck_1_#", 16),
  R("12:39:41", "boss_1_end", 17),
  gen("12:40:25", "2_10_town", 69, 1),
];

describe("labyrinth", () => {
  it("names rooms like the game", () => {
    expect(labRoomName("RT_branch_bottleneck_2")).toBe("Basilica Halls");
    expect(labRoomName("OH_quad_#")).toBe("Estate Crossing");
    expect(labRoomName("EH_end_bottleneck")).toBe("Mansion Annex");
    expect(labRoomName("EH_block_branch")).toBe("Mansion Halls");
  });

  it("a finished run: times, and the day's way without the detour", () => {
    const s = run(full).stats(at("13:00:00"));
    expect(s.current).toBeNull();
    expect(s.byLevel).toEqual([
      { level: 75, runs: 1, finished: 1, deaths: 0, avgMs: 556_000, avgToFinalMs: 512_000, bestToFinalMs: 512_000 },
    ]);
    expect(s.layouts).toEqual([{ level: 75, sections: [["Estate Walkways", "Domain Crossing"], ["Estate Path"], ["Domain Walkways"]] }]);
  });

  it("shows the next room of the same day, not of another day", () => {
    const l = run([...full, gen("13:00:00", "Labyrinth_Airlock", 33, 2), R("13:01:00", "OH_branch", 90)]);
    expect(l.stats(at("13:01:30")).current).toMatchObject({ room: "Estate Walkways", next: "Domain Crossing", fight: 0, ms: 30_000 });
    l.feed(parseLine(R("13:02:00", "DG_quad_door", 91))!);
    expect(l.stats(at("13:02:00")).current?.next).toBe("Izaro");
    l.feed(parseLine(R("13:03:00", "boss_1", 92))!);
    expect(l.stats(at("13:03:00")).current).toMatchObject({ inFight: true, fight: 1, next: "Estate Path" });
    const later = run([...full]);
    expect(later.stats(at("12:00:00") + 48 * 3600_000).layouts).toEqual([]);
  });

  it("a death ends the run unfinished, also in the final fight; trials are not runs", () => {
    const l = run([
      R("14:00:00", "OH_branch", 1),
      slain("14:01:00"),
      gen("14:01:05", "2_10_town", 69, 1),
      ...full.slice(0, -1),
      slain("12:40:00"),
      gen("12:40:25", "2_10_town", 69, 1),
      gen("15:00:00", "EndGame_Labyrinth_trials_arrows", 74, 5),
    ]);
    expect(l.runs.map((r) => [r.finished, r.deaths])).toEqual([[false, 1], [false, 1]]);
  });

  it("closing the game ends the run", () => {
    const l = run([R("14:00:00", "OH_branch", 1), `2026/11/19 14:02:00 1 a [INFO Client 1] Closing game gracefully`]);
    expect(l.runs[0]).toMatchObject({ finished: false, end: at("14:02:00") });
  });
});
