import { describe, expect, it } from "vitest";
import { parseLine } from "../src/core/clientLog";
import { GameSessionTracker, sessionDurationMs } from "../src/core/gameSessions";

const at = (t: string) => new Date(`2026-11-08T${t}`).getTime();
const L = (t: string, s: string) => `2026/11/08 ${t} 1 a [INFO Client 7] ${s}`;
const open = (t: string) => `2026/11/08 ${t} ***** LOG FILE OPENING *****`;
const gen = (t: string, id: string, seed: number, level = 83) =>
  `2026/11/08 ${t} 1 a [DEBUG Client 7] Generating level ${level} area "${id}" with seed ${seed}`;
const actOf = (id: string) => (/^1_1/.test(id) ? 1 : /^1_2/.test(id) ? 2 : null);

function run(lines: string[]): GameSessionTracker {
  const t = new GameSessionTracker(actOf);
  for (const l of lines) {
    const ev = parseLine(l);
    if (ev) t.feed(ev);
  }
  return t;
}

describe("GameSessionTracker", () => {
  it("summarises one game from opening to closing", () => {
    const t = run([
      open("18:00:00"),
      gen("18:01:00", "1_1_1", 1, 1),
      L("18:02:00", ": Foo (Witch) is now level 2"),
      L("18:03:00", "Successfully allocated passive skill id: int1, name: Intelligence"),
      L("18:03:05", "Successfully allocated passive skill id: atlas_path_1, name: Map Drop Chance"),
      gen("18:05:00", "1_2_1", 2, 13),
      L("18:20:00", ": Foo (Witch) is now level 12"),
      L("18:21:00", ": Foo has been slain."),
      gen("18:30:00", "MapWorldsStrand", 3),
      gen("18:33:00", "HideoutCourts", 4, 60),
      gen("18:34:00", "MapWorldsStrand", 3), // back through the portal: same map
      gen("18:40:00", "MavenBoss", 5, 84),
      L("19:00:00", "Closing game gracefully"),
    ]);
    expect(t.sessions).toHaveLength(1);
    const s = t.sessions[0];
    expect(s).toMatchObject({
      start: at("18:00:00"),
      end: at("19:00:00"),
      abrupt: false,
      deaths: 1,
      maps: 1,
      bossRuns: 1,
      passives: 1,
      maxAct: 2,
      characters: { Foo: { className: "Witch", fromLevel: 1, toLevel: 12 } },
    });
    expect(sessionDurationMs(s)).toBe(60 * 60_000);
    expect(t.current).toBeNull();
  });

  it("a new start after a crash closes the previous session at its last event", () => {
    const t = run([open("10:00:00"), gen("10:05:00", "MapWorldsBeach", 1), L("10:30:00", ": Foo has been slain."), open("11:00:00"), gen("11:01:00", "MapWorldsBeach", 2)]);
    expect(t.sessions).toHaveLength(2);
    expect(t.sessions[0]).toMatchObject({ end: at("10:30:00"), abrupt: true, deaths: 1 });
    expect(t.current).toMatchObject({ start: at("11:00:00"), maps: 1, end: null });
    expect(t.recent()[0]).toBe(t.current);
  });

  it("drops short sessions where nothing happened", () => {
    const t = run([open("09:00:00"), gen("09:00:20", "HideoutCourts", 1, 60), L("09:00:30", "Closing game gracefully"), open("12:00:00")]);
    expect(t.sessions).toHaveLength(1); // only the open 12:00 one
    expect(t.current?.start).toBe(at("12:00:00"));
  });
});
