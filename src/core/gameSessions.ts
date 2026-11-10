// Play sessions: one per game start ("***** LOG FILE OPENING *****") until it closes ("Closing game
// gracefully"; a crash leaves no closing line, so the next start or the last event ends it).
// Built from Client.txt, so the summaries cover every past session too.
import { arenaOf, farmIdOf } from "./bossRuns";
import type { LogEvent } from "./clientLog";
import { isMapArea } from "./maps";
import { isCharacterPassiveId } from "./passives";

export interface CharacterInSession {
  className: string;
  /** level when first seen leveling up in this session (level before the first level-up) */
  fromLevel: number;
  toLevel: number;
}

export interface GameSession {
  start: number;
  /** last event (still open while the game runs) */
  lastEvent: number;
  /** null while the game is open */
  end: number | null;
  /** closed without "Closing game gracefully" (crash, or still open when the app looked) */
  abrupt: boolean;
  characters: Record<string, CharacterInSession>;
  deaths: number;
  maps: number;
  bossRuns: number;
  zones: number;
  passives: number;
  /** highest campaign act entered */
  maxAct: number | null;
  /** boss fights and T17 maps done, by farm table id (for the expected earnings) */
  kills: Record<string, number>;
}

/** Sessions shorter than this with nothing done are noise (game opened by mistake, patch check). */
const kMinUsefulMs = 60 * 1000;

export class GameSessionTracker {
  readonly sessions: GameSession[] = [];
  private cur: GameSession | null = null;
  private seeds = new Set<string>();

  /** `actOf(areaId)` tells campaign zones apart (null for anything else). */
  constructor(private readonly actOf: (areaId: string) => number | null) {}

  private open(ts: number): GameSession {
    this.cur = {
      start: ts,
      lastEvent: ts,
      end: null,
      abrupt: false,
      characters: {},
      deaths: 0,
      maps: 0,
      bossRuns: 0,
      zones: 0,
      passives: 0,
      maxAct: null,
      kills: {},
    };
    this.seeds = new Set();
    this.sessions.push(this.cur);
    return this.cur;
  }

  private close(ts: number, abrupt: boolean): void {
    if (!this.cur) return;
    // a clean close ends at the closing line; after a crash only the last event is known
    this.cur.end = abrupt ? this.cur.lastEvent : Math.max(this.cur.lastEvent, ts);
    this.cur.abrupt = abrupt;
    const s = this.cur;
    this.cur = null;
    const empty = s.maps + s.bossRuns + s.deaths + s.passives === 0 && Object.keys(s.characters).length === 0;
    if (empty && (s.end ?? s.lastEvent) - s.start < kMinUsefulMs) this.sessions.pop();
  }

  /** Returns true when the current session changed. */
  feed(ev: LogEvent, now: number = Date.now()): boolean {
    const ts = ev.ts ?? now;
    if (ev.type === "focus" && ev.opening) {
      if (this.cur) this.close(this.cur.lastEvent, true); // the previous game crashed
      this.open(ts);
      return true;
    }
    if (ev.type === "focus" && ev.closing) {
      this.close(ts, false);
      return true;
    }
    const s = this.cur ?? this.open(ts);
    s.lastEvent = Math.max(s.lastEvent, ts);
    switch (ev.type) {
      case "area": {
        s.zones++;
        const key = `${ev.areaId}#${ev.seed}`;
        const fresh = !this.seeds.has(key);
        this.seeds.add(key);
        if (fresh && isMapArea(ev.areaId)) s.maps++;
        if (fresh && arenaOf(ev.areaId)) s.bossRuns++;
        const farm = fresh ? farmIdOf(ev.areaId, ev.areaLevel) : null;
        if (farm) s.kills[farm] = (s.kills[farm] ?? 0) + 1;
        const act = this.actOf(ev.areaId);
        if (act !== null && act > 0) s.maxAct = Math.max(s.maxAct ?? 0, act);
        return true;
      }
      case "levelup": {
        const c = s.characters[ev.character];
        if (c) c.toLevel = Math.max(c.toLevel, ev.level);
        else s.characters[ev.character] = { className: ev.className, fromLevel: ev.level - 1, toLevel: ev.level };
        return true;
      }
      case "death":
        s.deaths++;
        return true;
      case "passive":
        if (ev.allocated && isCharacterPassiveId(ev.skillId)) s.passives++;
        return ev.allocated;
      default:
        return false;
    }
  }

  get current(): GameSession | null {
    return this.cur;
  }

  /** Most recent first, the open one included. */
  recent(n = 10): GameSession[] {
    return this.sessions.slice(-n).reverse();
  }
}

export function sessionDurationMs(s: GameSession, now: number = Date.now()): number {
  return (s.end ?? Math.max(s.lastEvent, now)) - s.start;
}
