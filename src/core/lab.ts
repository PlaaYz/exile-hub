// Labyrinth runs in Client.txt: rooms, the three Izaro fights, times, deaths, and the day's rooms learned
// from the player's own runs (the layout is the same for everyone of a difficulty until 00:00 UTC; checked
// in the owner's log: same-day runs of a level repeat their rooms, only the optional branches differ).
import type { LogEvent } from "./clientLog";

/** Rooms only: the plaza (Labyrinth_Airlock) and the Trials of Ascendancy in maps (_trials_) are not a run. */
const ROOM_RE = /^(?:\d|EndGame)_Labyrinth_(?!trials)(.+)$/;
const FIGHT_RE = /^boss_\d/;
const FINAL_RE = /^boss_\d+_end/;

const THEMES: Record<string, string> = { OH: "Estate", DG: "Domain", RT: "Basilica", P: "Sanitorium", EH: "Mansion", C: "Sepulchre" };
/** [outdoor rooms (Estate, Domain), the others] */
const SHAPES: [RegExp, string, string][] = [
  [/straight/, "Path", "Passage"],
  [/branch/, "Walkways", "Halls"],
  [/quad/, "Crossing", "Atrium"],
  [/end/, "Enclosure", "Annex"],
];

/** "RT_branch_bottleneck_2" -> "Basilica Halls", as the game names it. */
export function labRoomName(room: string): string {
  const theme = room.split("_")[0];
  const shape = SHAPES.find(([re]) => re.test(room));
  if (!THEMES[theme] || !shape) return room;
  return `${THEMES[theme]} ${theme === "OH" || theme === "DG" ? shape[1] : shape[2]}`;
}

export function labName(level: number): string {
  return ({ 33: "Normal", 55: "Cruel", 68: "Merciless", 75: "Eternal" } as Record<number, string>)[level] ?? `Lv ${level}`;
}

interface Room {
  id: string;
  seed: number;
  ts: number;
}

export interface LabRun {
  level: number;
  start: number;
  /** null while inside */
  end: number | null;
  /** rooms of each section (before the 1st, 2nd and final fight), as visited */
  sections: Room[][];
  /** when each fight was entered */
  fights: { seed: number; ts: number }[];
  /** entered the final fight */
  finalAt: number | null;
  deaths: number;
  /** the log has no "completed" line: the final fight reached and left without a death */
  finished: boolean;
  inFight: boolean;
}

export interface LabAggregate {
  level: number;
  runs: number;
  finished: number;
  deaths: number;
  /** finished runs: whole run, and first room -> final fight */
  avgMs: number | null;
  avgToFinalMs: number | null;
  bestToFinalMs: number | null;
}

export interface LabStats {
  current: {
    level: number;
    ms: number;
    room: string;
    inFight: boolean;
    /** fights already entered */
    fight: number;
    final: boolean;
    deaths: number;
    /** the next room on today's known way; null = unknown */
    next: string | null;
  } | null;
  byLevel: LabAggregate[];
  today: LabAggregate[];
  recent: { level: number; start: number; ms: number; toFinalMs: number | null; finished: boolean; deaths: number; fights: number }[];
  /** today's rooms by section, learned from the player's runs (null = that section not done today) */
  layouts: { level: number; sections: (string[] | null)[] }[];
}

/** Labs change at 00:00 UTC. */
const labDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** The way without its detours: coming back to a room (same seed) drops everything after its first visit. */
function direct(rooms: Room[]): Room[] {
  const out: Room[] = [];
  for (const r of rooms) {
    const i = out.findIndex((x) => x.id === r.id && x.seed === r.seed);
    if (i >= 0) out.length = i + 1;
    else out.push(r);
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export class LabTracker {
  readonly runs: LabRun[] = [];
  private current: LabRun | null = null;

  feed(ev: LogEvent, now: number = Date.now()): boolean {
    const ts = ev.ts ?? now;
    if (ev.type === "death") {
      if (!this.current) return false;
      this.current.deaths++;
      if (this.current.finalAt !== null) this.current.finished = false;
      return true;
    }
    if (ev.type === "focus") return ev.closing ? this.close(ts) : false;
    if (ev.type === "login") return this.close(ts);
    if (ev.type !== "area") return false;
    const room = ROOM_RE.exec(ev.areaId)?.[1];
    if (!room) return this.close(ts);
    if (this.current?.level !== ev.areaLevel) this.close(ts);
    const run = (this.current ??= this.open(ev.areaLevel, ts));
    run.inFight = FIGHT_RE.test(room);
    if (!run.inFight) run.sections[run.fights.length]?.push({ id: room, seed: ev.seed, ts });
    else if (!run.fights.some((f) => f.seed === ev.seed) && run.fights.length < 3) {
      run.fights.push({ seed: ev.seed, ts });
      if (FINAL_RE.test(room)) {
        run.finalAt = ts;
        run.finished = true;
      }
    }
    return true;
  }

  private open(level: number, ts: number): LabRun {
    const run: LabRun = { level, start: ts, end: null, sections: [[], [], []], fights: [], finalAt: null, deaths: 0, finished: false, inFight: false };
    this.runs.push(run);
    return run;
  }

  private close(ts: number): boolean {
    if (!this.current) return false;
    this.current.end = ts;
    this.current = null;
    return true;
  }

  /** Today's shortest known way through a section (fewest rooms, then fastest); null = not done today. */
  private way(level: number, section: number, now: number): Room[] | null {
    let best: { rooms: Room[]; ms: number } | null = null;
    for (const r of this.runs) {
      if (r.level !== level || labDay(r.start) !== labDay(now) || r.fights.length <= section) continue;
      const rooms = direct(r.sections[section]);
      const ms = r.fights[section].ts - (section ? r.fights[section - 1].ts : r.start);
      if (!best || rooms.length < best.rooms.length || (rooms.length === best.rooms.length && ms < best.ms)) best = { rooms, ms };
    }
    return best?.rooms ?? null;
  }

  private next(run: LabRun, now: number): string | null {
    const section = run.fights.length;
    if (section > 2) return null;
    const way = this.way(run.level, section, now);
    if (!way) return null;
    const mine = direct(run.sections[section]);
    const here = mine[mine.length - 1];
    if (!here) return way[0] ? labRoomName(way[0].id) : "Izaro";
    // the same room type can appear twice in a section: the n-th here is the n-th there
    const nth = mine.filter((r) => r.id === here.id).length;
    let seen = 0;
    const i = way.findIndex((r) => r.id === here.id && ++seen === nth);
    if (i < 0) return null;
    return way[i + 1] ? labRoomName(way[i + 1].id) : "Izaro";
  }

  private aggregate(runs: LabRun[]): LabAggregate[] {
    return [...new Set(runs.map((r) => r.level))]
      .sort((a, b) => b - a)
      .map((level) => {
        const mine = runs.filter((r) => r.level === level);
        const done = mine.filter((r) => r.finished);
        const toFinal = done.map((r) => r.finalAt! - r.start);
        return {
          level,
          runs: mine.length,
          finished: done.length,
          deaths: mine.reduce((a, r) => a + r.deaths, 0),
          avgMs: mean(done.map((r) => r.end! - r.start)),
          avgToFinalMs: mean(toFinal),
          bestToFinalMs: toFinal.length ? Math.min(...toFinal) : null,
        };
      });
  }

  stats(now: number = Date.now()): LabStats {
    const closed = this.runs.filter((r) => r.end !== null);
    const today = this.runs.filter((r) => labDay(r.start) === labDay(now));
    const cur = this.current;
    const rooms = cur ? cur.sections.flat() : [];
    return {
      current: cur && {
        level: cur.level,
        ms: Math.max(0, now - cur.start),
        room: rooms.length ? labRoomName(rooms[rooms.length - 1].id) : "",
        inFight: cur.inFight,
        fight: cur.fights.length,
        final: cur.finalAt !== null,
        deaths: cur.deaths,
        next: this.next(cur, now),
      },
      byLevel: this.aggregate(closed),
      today: this.aggregate(closed.filter((r) => labDay(r.start) === labDay(now))),
      recent: closed
        .slice(-12)
        .reverse()
        .map((r) => ({
          level: r.level,
          start: r.start,
          ms: r.end! - r.start,
          toFinalMs: r.finalAt === null ? null : r.finalAt - r.start,
          finished: r.finished,
          deaths: r.deaths,
          fights: r.fights.length,
        })),
      layouts: [...new Set(today.map((r) => r.level))]
        .sort((a, b) => b - a)
        .map((level) => ({ level, sections: [0, 1, 2].map((s) => this.way(level, s, now)?.map((r) => labRoomName(r.id)) ?? null) }))
        .filter((l) => l.sections.some((s) => s !== null)),
    };
  }
}
