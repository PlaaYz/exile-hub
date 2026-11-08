// Map tracker: every map run in Client.txt, with time spent inside, deaths and sessions.
//
// A run is one map instance (area id + seed). Going to the hideout and back through a portal is the
// same run; sub-areas opened from inside the map (abyss depths, trials, league encounters) count
// as time in the map. The run ends when another map instance starts.
import type { LogEvent } from "./clientLog";
import { ARENAS } from "./bossRuns";

const arenaIds = new Set(ARENAS.map((a) => a.areaId).filter(Boolean));

/** Regular atlas maps; pinnacle arenas and other "MapWorlds...Boss" fights are not maps here. */
export function isMapArea(id: string): boolean {
  return id.startsWith("MapWorlds") && !arenaIds.has(id) && !/Boss/.test(id);
}

export function isHideoutOrTown(id: string): boolean {
  return /^Hideout/.test(id) || /_town$/.test(id) || /^Menagerie_Hub$/.test(id);
}

/** Area level 68 = tier 1 ... 83 = tier 16, 84 = tier 17. */
export function mapTier(level: number): number {
  return Math.max(1, Math.min(17, level - 67));
}

/** Gaps longer than this between maps start a new play session. */
export const kSessionGapMs = 30 * 60 * 1000;
/** Longest stretch counted inside one map without leaving it. */
export const kMaxSegmentMs = 60 * 60 * 1000;

export interface MapRun {
  areaId: string;
  seed: number;
  level: number;
  name: string;
  start: number;
  /** last time the player left the map (or a sub-area of it); null while inside */
  lastExit: number | null;
  inMapMs: number;
  deaths: number;
  /** league mechanics met in this map (NPC dialogue in Client.txt), in order */
  mechanics: string[];
}

type Where = "map" | "sub" | "out";

export interface MapAggregate {
  maps: number;
  /** wall time from the first map start to the last exit */
  ms: number;
  inMapMs: number;
  avgMapMs: number;
  mapsPerHour: number | null;
  deaths: number;
}

export interface MapStats {
  current: {
    name: string;
    tier: number;
    level: number;
    start: number;
    inMapMs: number;
    deaths: number;
    inside: boolean;
    mechanics: string[];
  } | null;
  session: MapAggregate | null;
  today: MapAggregate | null;
  allTime: (MapAggregate & { since: number }) | null;
  recent: { name: string; tier: number; inMapMs: number; deaths: number; start: number; mechanics: string[] }[];
  /** how often each mechanic shows up: in how many maps, and the share of all maps */
  mechanics: { name: string; maps: number; share: number }[];
  byMap: { name: string; count: number; avgMs: number; deathsPerRun: number }[];
}

export class MapTracker {
  readonly runs: MapRun[] = [];
  private current: MapRun | null = null;
  private where: Where = "out";
  private segStart = 0;
  /** the last area line was a fresh map: the next "You have entered" names it */
  private naming = false;

  feed(ev: LogEvent, now: number = Date.now()): boolean {
    const ts = ev.ts ?? now;
    switch (ev.type) {
      case "area": {
        let changed = this.closeSegment(ts);
        this.naming = false;
        const cur = this.current;
        if (isMapArea(ev.areaId)) {
          if (cur && cur.areaId === ev.areaId && cur.seed === ev.seed) {
            cur.lastExit = null; // back through the portal
          } else {
            this.current = {
              areaId: ev.areaId,
              seed: ev.seed,
              level: ev.areaLevel,
              name: ev.areaId.replace(/^MapWorlds/, ""),
              start: ts,
              lastExit: null,
              inMapMs: 0,
              deaths: 0,
              mechanics: [],
            };
            this.runs.push(this.current);
            this.naming = true;
          }
          this.where = "map";
          this.segStart = ts;
          return true;
        }
        if (isHideoutOrTown(ev.areaId)) {
          this.where = "out";
        } else if (this.where !== "out" && cur) {
          this.where = "sub"; // opened from inside the map
          this.segStart = ts;
          cur.lastExit = null;
          changed = true;
        } else {
          this.where = "out"; // campaign, lab, delve... started from town/hideout
        }
        return changed;
      }
      case "enter":
        if (this.naming && this.current) {
          this.current.name = ev.name;
          this.naming = false;
          return true;
        }
        return false;
      case "npc":
        // only inside a map (the same NPCs talk in towns and in the campaign)
        if (this.where === "out" || !this.current || this.current.mechanics.includes(ev.mechanic)) return false;
        this.current.mechanics.push(ev.mechanic);
        return true;
      case "death":
        if (this.where !== "out" && this.current) {
          this.current.deaths++;
          return true;
        }
        return false;
      case "focus": {
        if (!ev.closing) return false; // alt-tab: still in the map
        // the game closed (or a new one started after a crash): the player is out of the map
        const changed = this.closeSegment(ts);
        this.where = "out";
        this.naming = false;
        return changed;
      }
      default:
        return false;
    }
  }

  private closeSegment(ts: number): boolean {
    if (this.where === "out" || !this.current) return false;
    // a stretch longer than this is the game left open / a lost closing line, not mapping
    this.current.inMapMs += Math.min(kMaxSegmentMs, Math.max(0, ts - this.segStart));
    this.current.lastExit = ts;
    return true;
  }

  private lastActivity(r: MapRun): number {
    return r.lastExit ?? r.start + r.inMapMs;
  }

  stats(now: number = Date.now()): MapStats {
    const runs = this.runs;
    const live = (r: MapRun) =>
      r === this.current && this.where !== "out" ? r.inMapMs + Math.max(0, now - this.segStart) : r.inMapMs;

    // sessions: runs closer than kSessionGapMs
    const sessions: MapRun[][] = [];
    for (const r of runs) {
      const last = sessions[sessions.length - 1];
      const prev = last?.[last.length - 1];
      if (prev && r.start - this.lastActivity(prev) <= kSessionGapMs) last.push(r);
      else sessions.push([r]);
    }

    // wall time of a set of runs = sum of the play sessions they belong to (not first-to-last,
    // which would count the nights in between)
    const sessionOf = new Map<MapRun, MapRun[]>();
    for (const s of sessions) for (const r of s) sessionOf.set(r, s);
    const agg = (rs: MapRun[]): MapAggregate | null => {
      if (!rs.length) return null;
      const inside = rs.map(live);
      const inMapMs = inside.reduce((a, b) => a + b, 0);
      let ms = 0;
      const set = new Set(rs);
      for (const s of new Set(rs.map((r) => sessionOf.get(r)!))) {
        const mine = s.filter((r) => set.has(r));
        const lastR = mine[mine.length - 1];
        const end = lastR === this.current && this.where !== "out" ? now : this.lastActivity(lastR);
        ms += Math.max(0, end - mine[0].start);
      }
      ms = Math.max(ms, inMapMs);
      return {
        maps: rs.length,
        ms,
        inMapMs,
        avgMapMs: inMapMs / rs.length,
        mapsPerHour: ms >= 10 * 60 * 1000 ? (rs.length * 3600_000) / ms : null,
        deaths: rs.reduce((a, r) => a + r.deaths, 0),
      };
    };

    const cur = this.current;
    const curActive = !!cur && (this.where !== "out" || now - this.lastActivity(cur) <= kSessionGapMs);
    const lastSession = sessions[sessions.length - 1];
    const sessionActive = !!lastSession && now - this.lastActivity(lastSession[lastSession.length - 1]) <= kSessionGapMs;
    const today = new Date(now).toDateString();
    const todayRuns = runs.filter((r) => new Date(r.start).toDateString() === today);

    const byName = new Map<string, MapRun[]>();
    for (const r of runs) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);

    return {
      current:
        curActive && cur
          ? {
              name: cur.name,
              tier: mapTier(cur.level),
              level: cur.level,
              start: cur.start,
              inMapMs: live(cur),
              deaths: cur.deaths,
              inside: this.where !== "out",
              mechanics: [...cur.mechanics],
            }
          : null,
      session: sessionActive ? agg(lastSession) : null,
      today: agg(todayRuns),
      allTime: runs.length ? { ...agg(runs)!, since: runs[0].start } : null,
      recent: runs
        .slice(-15)
        .reverse()
        .map((r) => ({ name: r.name, tier: mapTier(r.level), inMapMs: live(r), deaths: r.deaths, start: r.start, mechanics: [...r.mechanics] })),
      mechanics: mechanicShares(runs),
      byMap: [...byName]
        .map(([name, rs]) => ({
          name,
          count: rs.length,
          avgMs: rs.reduce((a, r) => a + live(r), 0) / rs.length,
          deathsPerRun: rs.reduce((a, r) => a + r.deaths, 0) / rs.length,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
    };
  }
}

function mechanicShares(runs: MapRun[]): MapStats["mechanics"] {
  const count = new Map<string, number>();
  for (const r of runs) for (const m of r.mechanics) count.set(m, (count.get(m) ?? 0) + 1);
  return [...count]
    .map(([name, maps]) => ({ name, maps, share: runs.length ? maps / runs.length : 0 }))
    .sort((a, b) => b.maps - a.maps);
}