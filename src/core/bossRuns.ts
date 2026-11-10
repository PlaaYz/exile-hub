// Detects pinnacle boss runs in Client.txt: entering a boss arena starts a run, leaving it ends the
// run, re-entering the same instance (same seed, e.g. after a death) continues it. Feeds the farm
// tab with real run counts and times, so nobody has to type "minutes per run".
import type { LogEvent } from "./clientLog";

export interface Arena {
  /** area id from "Generating level N area "ID"" */
  areaId?: string;
  /** name from "You have entered NAME." (used when the area id is not known) */
  enteredName?: string;
  /** FARM_BOSSES id for the normal fight */
  boss: string;
  /** FARM_BOSSES id for the uber fight (area level >= kUberLevel), if any */
  uber?: string;
  /** false: id/name not seen in a real log yet (community knowledge) */
  verified: boolean;
}

/** Uber pinnacle fights are generated at area level 85; the normal ones at 83-84. */
export const kUberLevel = 85;

export const ARENAS: Arena[] = [
  // seen in the owner's Client.txt (2026)
  { areaId: "AtlasExilesBoss5", enteredName: "Eye of the Storm", boss: "sirus", uber: "uber-sirus", verified: true },
  { areaId: "MavenBoss", enteredName: "Absence of Mercy and Empathy", boss: "maven", uber: "uber-maven", verified: true },
  {
    areaId: "MapWorldsPrimordialBoss3",
    enteredName: "Absence of Patience and Wisdom",
    boss: "exarch",
    uber: "uber-exarch",
    verified: true,
  },
  {
    areaId: "MapWorldsPrimordialBoss4",
    enteredName: "Absence of Symmetry and Harmony",
    boss: "eater",
    uber: "uber-eater",
    verified: true,
  },
  { areaId: "MapWorldsShapersRealm", enteredName: "The Shaper's Realm", boss: "shaper", uber: "uber-shaper", verified: true },
  {
    areaId: "MapWorldsElderArena",
    enteredName: "Absence of Value and Meaning",
    boss: "uber-elder",
    uber: "uber-uber-elder",
    verified: true,
  },
  // seen in the owner's Client.txt, checked by the "You have entered" line (2026-11-09)
  { areaId: "BetrayalMastermindFight", enteredName: "Mastermind's Lair", boss: "catarina", verified: true },
  { areaId: "MapWorldsMemoryBoss1", enteredName: "Moment of Trauma", boss: "incarnation-fear", uber: "uber-incarnation-fear", verified: true },
  { areaId: "MapWorldsMemoryBoss2", enteredName: "Moment of Loneliness", boss: "incarnation-neglect", uber: "uber-incarnation-neglect", verified: true },
  { areaId: "MapWorldsMemoryBoss3", enteredName: "Moment of Reverence", boss: "incarnation-dread", uber: "uber-incarnation-dread", verified: true },
  { areaId: "MapWorldsPrimordialBoss1", enteredName: "Seething Chyme", boss: "infinite-hunger", verified: true },
  { areaId: "MapWorldsPrimordialBoss2", enteredName: "Polaric Void", boss: "black-star", verified: true },
  // not in the owner's log yet: matched by arena name only
  { enteredName: "Cortex", boss: "uber-venarius", verified: false }, // only the uber fight is farmed
];

const byId = new Map(ARENAS.filter((a) => a.areaId).map((a) => [a.areaId!, a]));
const byName = new Map(ARENAS.filter((a) => a.enteredName).map((a) => [a.enteredName!, a]));

/** The boss arena for an area id, if it is one (diagnostics). */
export function arenaOf(areaId: string): Arena | undefined {
  return byId.get(areaId);
}

/** T17 nightmare maps by area id (seen in the owner's Client.txt): their FARM_BOSSES ids. */
const T17_AREAS: Record<string, string> = {
  MapWorldsCitadel: "t17-citadel",
  MapWorldsSanctuary: "t17-sanctuary",
  MapWorldsZiggurat: "t17-ziggurat",
  MapWorldsFortress: "t17-fortress",
  MapWorldsAbomination: "t17-abomination",
};

/** The farm table (FARM_BOSSES id) a fresh instance of this area counts for, if any. */
export function farmIdOf(areaId: string, areaLevel: number): string | null {
  const a = byId.get(areaId);
  if (a) return areaLevel >= kUberLevel && a.uber ? a.uber : a.boss;
  return T17_AREAS[areaId] ?? null;
}

export interface BossRun {
  boss: string;
  areaId: string;
  seed: number;
  level: number;
  start: number;
  /** null while still inside the arena */
  end: number | null;
  deaths: number;
}

export interface BossStats {
  boss: string;
  runs: number;
  /** median seconds inside the arena */
  fightSec: number | null;
  /** median seconds from one run's start to the next (same boss, back to back) */
  cycleSec: number | null;
  deaths: number;
  lastRunAt: number | null;
}

/** Runs of the same boss closer than this count as back-to-back farming for the cycle time. */
export const kCycleMaxGapMs = 20 * 60 * 1000;
/** Leaving and re-entering the same instance within this window is the same run. */
const kRejoinMs = 10 * 60 * 1000;

interface AreaInfo {
  areaId: string;
  level: number;
  seed: number;
  ts: number;
}

export class BossRunTracker {
  readonly runs: BossRun[] = [];
  private current: BossRun | null = null;
  private lastArea: AreaInfo | null = null;

  /** Returns true when the run list changed. */
  feed(ev: LogEvent, now: number = Date.now()): boolean {
    const ts = ev.ts ?? now;
    switch (ev.type) {
      case "area": {
        this.lastArea = { areaId: ev.areaId, level: ev.areaLevel, seed: ev.seed, ts };
        const arena = byId.get(ev.areaId);
        if (arena) return this.enterArena(arena, this.lastArea);
        return this.leave(ts);
      }
      case "enter": {
        // arenas only known by name: the area line came just before
        const arena = byName.get(ev.name);
        if (!arena || arena.areaId || !this.lastArea) return false;
        return this.enterArena(arena, this.lastArea);
      }
      case "focus":
        // the game closed (or restarted after a crash) during the fight: the run ends there
        return ev.closing ? this.leave(ts) : false;
      case "death":
        if (this.current && this.current.end === null) {
          this.current.deaths++;
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  private enterArena(arena: Arena, a: AreaInfo): boolean {
    const boss = a.level >= kUberLevel && arena.uber ? arena.uber : arena.boss;
    const last = this.current;
    if (last && last.areaId === a.areaId && last.seed === a.seed && (last.end === null || a.ts - last.end < kRejoinMs)) {
      last.end = null; // back into the same fight
      return false;
    }
    if (last && last.end === null) last.end = a.ts;
    this.current = { boss, areaId: a.areaId, seed: a.seed, level: a.level, start: a.ts, end: null, deaths: 0 };
    this.runs.push(this.current);
    return true;
  }

  private leave(ts: number): boolean {
    if (this.current && this.current.end === null) {
      this.current.end = ts;
      return true;
    }
    return false;
  }

  stats(): Map<string, BossStats> {
    const out = new Map<string, BossStats>();
    const byBoss = new Map<string, BossRun[]>();
    for (const r of this.runs) {
      const l = byBoss.get(r.boss) ?? [];
      l.push(r);
      byBoss.set(r.boss, l);
    }
    for (const [boss, runs] of byBoss) {
      const fights = runs.filter((r) => r.end !== null).map((r) => (r.end! - r.start) / 1000);
      const cycles: number[] = [];
      for (let i = 1; i < runs.length; i++) {
        const gap = runs[i].start - runs[i - 1].start;
        if (gap > 0 && gap <= kCycleMaxGapMs) cycles.push(gap / 1000);
      }
      out.set(boss, {
        boss,
        runs: runs.length,
        fightSec: median(fights),
        cycleSec: median(cycles),
        deaths: runs.reduce((a, r) => a + r.deaths, 0),
        lastRunAt: runs[runs.length - 1].start,
      });
    }
    return out;
  }
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Minutes per run to use for profit/hour: the back-to-back cycle when there are at least two
 * such runs (it includes opening the map, travel and looting), else the fight time plus a
 * minute of overhead, else null.
 */
export function measuredMinutes(s: BossStats | undefined): number | null {
  if (!s) return null;
  if (s.cycleSec !== null) return Math.round((s.cycleSec / 60) * 10) / 10;
  if (s.fightSec !== null) return Math.round((s.fightSec / 60 + 1) * 10) / 10;
  return null;
}
