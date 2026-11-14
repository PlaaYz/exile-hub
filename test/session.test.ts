import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Lookups } from "../src/core/route";
import { Session } from "../src/core/session";

const data = path.resolve(__dirname, "../data");
const lookups: Lookups = {
  areas: JSON.parse(fs.readFileSync(path.join(data, "json/areas.json"), "utf8")),
  quests: JSON.parse(fs.readFileSync(path.join(data, "json/quests.json"), "utf8")),
};
const routes = Array.from({ length: 10 }, (_, i) =>
  fs.readFileSync(path.join(data, `routes/act-${i + 1}.txt`), "utf8"),
);

const area = (id: string, t = "12:00:00") =>
  `2026/11/08 ${t} 1 a [DEBUG Client 1] Generating level 1 area "${id}" with seed 1`;
const lvl = (n: number) => `2026/11/08 12:00:00 1 a [INFO Client 1] : Foo (Witch) is now level ${n}`;
const death = "2026/11/08 12:00:00 1 a [INFO Client 1] : Foo has been slain.";

describe("Session", () => {
  it("follows area changes, level ups and starts the act timer", () => {
    const s = new Session(lookups, routes, true);
    expect(s.applyLine(area("1_1_1", "12:00:00"))).toBe(true);
    expect(s.areaId).toBe("1_1_1");
    expect(s.areaName).toBe(lookups.areas["1_1_1"].name);
    expect(s.applyLine(lvl(2))).toBe(true);
    expect(s).toMatchObject({ characterName: "Foo", className: "Witch", characterLevel: 2 });
    expect(s.applyLine(area("1_1_2", "12:01:00"))).toBe(true);
    const snap = s.timer.snapshot(new Date(2026, 10, 8, 12, 2, 0).getTime());
    expect(snap.act).toBe(1);
    expect(snap.runMs).toBe(120_000);
  });

  it("does not report a change for deaths or noise", () => {
    const s = new Session(lookups, routes, true);
    expect(s.applyLine(death)).toBe(false);
    expect(s.applyLine("garbage")).toBe(false);
  });

  it("keeps unknown areas (hideouts) out of the route and timers", () => {
    const s = new Session(lookups, routes, true);
    const before = s.tracker.view().cursor;
    expect(s.applyLine(area("HideoutNotInCampaign"))).toBe(true);
    expect(s.areaName).toBe("HideoutNotInCampaign");
    expect(s.tracker.view().cursor).toBe(before);
    expect(s.timer.snapshot(Date.now()).act).toBeNull();
  });

  it("backfill anchors the route to the last area without starting timers", () => {
    const s = new Session(lookups, routes, true);
    s.backfill([area("1_1_1"), lvl(5), area("1_1_2"), death]);
    expect(s.areaId).toBe("1_1_2");
    expect(s.characterLevel).toBe(5);
    expect(s.tracker.view().cursor).toBeGreaterThan(0);
    expect(s.timer.snapshot(Date.now()).act).toBeNull();
  });

  it("backfill uses the 'You have entered' name for areas outside the campaign", () => {
    const s = new Session(lookups, routes, true);
    s.backfill([
      area("HideoutCourts"),
      "2026/11/08 12:00:01 1 a [INFO Client 1] : You have entered Stately Hideout.",
    ]);
    expect(s.areaId).toBe("HideoutCourts");
    expect(s.areaName).toBe("Stately Hideout");
  });

  const lvlOf = (name: string, cls: string, n: number, t = "12:00:00") =>
    `2026/11/08 ${t} 1 a [INFO Client 1] : ${name} (${cls}) is now level ${n}`;
  const at = (t: string) => new Date(`2026-11-08T${t}`).getTime();
  const actOneZones = ["1_1_1", "1_1_town", "1_1_2", "1_1_3", "1_1_4_1"];

  it("starts a new run when a new character appears in the Twilight Strand", () => {
    const s = new Session(lookups, routes, true);
    actOneZones.forEach((z, i) => s.applyLine(area(z, `12:0${i}:00`)));
    s.applyLine(lvlOf("Old", "Witch", 12));
    expect(s.tracker.cursor).toBeGreaterThan(3);
    s.applyLine(area("HideoutCourts", "12:10:00")); // logs out to char select, new char...
    s.applyLine(area("1_1_1", "12:11:00"));
    expect(s.tracker.view().cursor).toBeLessThanOrEqual(3);
    expect(s.characterName).toBeNull();
    expect(s.timer.snapshot(at("12:12:00")).runMs).toBe(60_000);
    s.applyLine(lvlOf("New", "Ranger", 2, "12:12:00"));
    expect(s).toMatchObject({ characterName: "New", className: "Ranger", characterLevel: 2 });
    expect(s.timer.snapshot(at("12:12:00")).runMs).toBe(60_000); // the new run is kept
  });

  it("walking back from Lioneye's Watch to the Strand is not a new run", () => {
    const s = new Session(lookups, routes, true);
    actOneZones.forEach((z) => s.applyLine(area(z)));
    s.applyLine(area("1_1_town"));
    const c = s.tracker.cursor;
    s.applyLine(area("1_1_1"));
    expect(s.tracker.cursor).toBeLessThanOrEqual(c); // rewinds, but...
    expect(s.timer.snapshot(at("12:30:00")).runMs).toBeGreaterThan(0); // ...timers survive
  });

  it("switches saved progress between characters and pauses the other one's timer", () => {
    const s = new Session(lookups, routes, true);
    s.applyLine(lvlOf("A", "Witch", 10, "12:00:00"));
    actOneZones.forEach((z, i) => s.applyLine(area(z, `12:0${i}:00`)));
    const cursorA = s.tracker.cursor;
    const runA = s.timer.snapshot(at("12:04:00")).runMs; // 4 min
    s.applyLine(lvlOf("B", "Duelist", 40, "12:04:00")); // B seen for the first time: route kept
    expect(s.characterName).toBe("B");
    s.applyLine(lvlOf("A", "Witch", 11, "12:30:00")); // back to A 26 minutes later
    expect(s.tracker.cursor).toBe(cursorA);
    expect(s.timer.snapshot(at("12:30:00")).runMs).toBe(runA); // B's time did not count for A
  });

  it("exports and imports progress, resuming the timer after the app was closed", () => {
    const s = new Session(lookups, routes, true);
    s.applyLine(lvlOf("A", "Witch", 10, "12:00:00"));
    actOneZones.forEach((z, i) => s.applyLine(area(z, `12:0${i}:00`)));
    const data = JSON.parse(JSON.stringify(s.exportProgress(at("12:05:00"))));
    const t = new Session(lookups, routes, true);
    t.importProgress(data, at("18:00:00"));
    expect(t).toMatchObject({ characterName: "A", className: "Witch", characterLevel: 10 });
    expect(t.tracker.cursor).toBe(s.tracker.cursor);
    expect(t.timer.snapshot(at("18:00:00")).runMs).toBe(5 * 60_000);
    // the log tail at startup moves relative to the restored place (next zone of Act 1)
    t.backfill([area("1_1_5")], at("18:00:00"));
    expect(t.tracker.view().areaId).toBe("1_1_5");
    expect(t.tracker.cursor).toBeGreaterThan(s.tracker.cursor);
  });

  it("switches to endgame in maps / high-level areas and back in a campaign zone", () => {
    const s = new Session(lookups, routes, true);
    const lvlArea = (id: string, level: number) =>
      `2026/11/08 12:00:00 1 a [DEBUG Client 1] Generating level ${level} area "${id}" with seed 7`;
    s.applyLine(area("1_1_2"));
    expect(s.endgame).toBe(false);
    s.applyLine(lvlArea("HideoutCourts", 70)); // hideouts tell nothing
    expect(s.endgame).toBe(false);
    s.applyLine(lvlArea("MapWorldsCitySquare", 83));
    expect(s.endgame).toBe(true);
    s.applyLine(lvlArea("HideoutCourts", 1));
    expect(s.endgame).toBe(true);
    s.applyLine(lvlArea("SomeEndgameArea", 75)); // e.g. Eternal Labyrinth
    expect(s.endgame).toBe(true);
    s.applyLine(area("1_1_town"));
    expect(s.endgame).toBe(false);
    // Karui Shores is "act 11" in the zone data: the endgame town, not campaign
    const cursor = s.tracker.cursor;
    s.applyLine(lvlArea("2_11_endgame_town", 69));
    expect(s.endgame).toBe(true);
    expect(s.tracker.cursor).toBe(cursor);
  });

  it("after a login the last character stays as a guess; the area it logs into can tell who it is", () => {
    const login = "2026/11/08 12:00:00 1 a [INFO Client 1] Async connecting to sao.login.pathofexile.com:20492";
    const mapArea = (id: string, level: number) =>
      `2026/11/08 12:00:00 1 a [DEBUG Client 1] Generating level ${level} area "${id}" with seed 1`;
    const s = new Session(lookups, routes, true);
    s.applyLine(lvlOf("Camp", "Witch", 6, "12:00:00"));
    s.applyLine(area("1_1_town"));
    s.applyLine(login); // game restart or character select: most players keep the same character
    expect(s).toMatchObject({ characterName: "Camp", characterLevel: 6 });
    s.applyLine(area("HideoutCourts"));
    expect(s.characterName).toBe("Camp"); // a shared hideout says nothing either way
    s.applyLine(lvlOf("Mapper", "Duelist", 95));
    expect(s.characterName).toBe("Mapper");
    s.applyLine(login); // back to the campaign character, who logs in where they left
    s.applyLine(area("1_1_town"));
    expect(s).toMatchObject({ characterName: "Camp", characterLevel: 6 });
    s.applyLine(login);
    s.applyLine(area("HideoutCourts"));
    expect(s.characterName).toBe("Camp"); // still the guess...
    s.applyLine(mapArea("MapWorldsStrand", 83));
    expect(s.characterName).toBeNull(); // ...until a level 6 character cannot be where the player is
  });

  it("never assumes a character in an area far above its level", () => {
    const login = "2026/11/08 12:00:00 1 a [INFO Client 1] Async connecting to sao.login.pathofexile.com:20492";
    const lvlArea = (id: string, level: number) =>
      `2026/11/08 12:00:00 1 a [DEBUG Client 1] Generating level ${level} area "${id}" with seed 1`;
    const s = new Session(lookups, routes, true);
    s.applyLine(lvlOf("Low", "Duelist", 6));
    s.applyLine(lvlArea("1_1_town", 13));
    s.applyLine(lvlArea("1_5_town", 45)); // a level 6 character cannot be here: someone else
    expect(s.characterName).toBeNull();

    const t = new Session(lookups, routes, true);
    t.applyLine(lvlOf("Low", "Duelist", 6));
    t.applyLine(lvlArea("HideoutCourts", 60));
    expect(t.characterName).toBe("Low"); // hideouts do not count
    t.applyLine(login);
    t.applyLine(lvlArea("1_5_town", 45)); // not where Low can be
    expect(t.characterName).toBeNull();
  });

  it("a guessed character's saved progress is not overwritten by someone else's play", () => {
    const login = "2026/11/08 12:00:00 1 a [INFO Client 1] Async connecting to sao.login.pathofexile.com:20492";
    const s = new Session(lookups, routes, true);
    s.applyLine(lvlOf("Main", "Witch", 8));
    s.applyLine(area("1_1_2"));
    const saved = s.exportProgress().characters.Main.cursor;
    s.applyLine(login); // actually an alt logs in, in the hideout
    s.applyLine(area("HideoutCourts"));
    s.applyLine(area("1_1_3")); // the alt walks on: Main is only a guess, its progress stays
    expect(s.exportProgress().characters.Main.cursor).toBe(saved);
    s.applyLine(lvlOf("Alt", "Ranger", 9)); // the log names the alt
    expect(s.characterName).toBe("Alt");
    expect(s.exportProgress().characters.Main.cursor).toBe(saved);
  });

  it("backfill remembers the area a character logged out from", () => {
    const login = "2026/11/08 12:00:00 1 a [INFO Client 1] Async connecting to sao.login.pathofexile.com:20492";
    const s = new Session(lookups, routes, true);
    s.backfill([lvlOf("A", "Witch", 8), area("1_1_2"), login, area("HideoutCourts"), login, area("1_1_2")]);
    expect(s.characterName).toBe("A");
  });

  it("the death of one of the account's characters names who is playing, with its level from the log", () => {
    const login = "2026/11/08 12:00:00 1 a [INFO Client 1] Async connecting to sao.login.pathofexile.com:20492";
    const slain = (who: string) => `2026/11/08 12:00:00 1 a [INFO Client 1] : ${who} has been slain.`;
    const s = new Session(lookups, routes, true);
    s.known = (n) => (n === "OldMapper" ? { className: "Ascendant", level: 96 } : undefined);
    s.applyLine(lvlOf("Camp", "Witch", 6));
    s.applyLine(login);
    s.applyLine(area("HideoutCourts"));
    expect(s.characterName).toBe("Camp"); // the guess
    expect(s.applyLine(slain("SomeoneElse"))).toBe(false); // a party member: not one of ours
    expect(s.characterName).toBe("Camp");
    expect(s.applyLine(slain("OldMapper"))).toBe(true);
    expect(s).toMatchObject({ characterName: "OldMapper", className: "Ascendant", characterLevel: 96 });
  });

  it("parses window focus lines", () => {
    const s = new Session(lookups, routes, true);
    expect(s.applyLine("2026/11/08 12:00:00 1 a [INFO Client 1] [WINDOW] Lost focus")).toBe(false);
  });

  it("rebuild keeps the current zone", () => {
    const s = new Session(lookups, routes, true);
    s.backfill([area("1_1_2")]);
    s.rebuild(false);
    expect(s.tracker.view().areaId).toBe("1_1_2");
  });
});

describe("Session after a restart", () => {
  it("knows it is endgame from earlier areas even when the last one is a hideout", () => {
    const lvlArea = (id: string, level: number) => `2026/11/08 12:00:00 1 a [DEBUG Client 1] Generating level ${level} area "${id}" with seed 1`;
    const s = new Session(lookups, routes, true);
    s.backfill([lvlArea("MapWorldsStrand", 83), lvlArea("HideoutCourts", 60)]);
    expect(s.endgame).toBe(true);
  });
});

describe("act timer and the game being closed", () => {
  it("stands still while the game is closed and goes on from where it was", async () => {
    const { RunTimer } = await import("../src/core/timer");
    const t = new RunTimer();
    const m = (n: number) => 1_800_000_000_000 + n * 60_000; // minute n of a real clock
    t.onArea(1, m(0));
    t.pause(m(1)); // game closed after 1 min
    expect(t.snapshot(m(10)).actMs).toBe(60_000); // 10 min later: still 1 min
    t.unpause(m(10));
    expect(t.snapshot(m(11)).actMs).toBe(120_000);
    t.pause(m(12));
    t.onArea(2, m(20)); // a zone means the game runs again
    expect(t.snapshot(m(20)).splits[1]).toBe(180_000);
    expect(t.snapshot(m(21)).runMs).toBe(240_000);
  });
});
