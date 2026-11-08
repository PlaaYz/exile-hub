import { parseLine, type LogEvent } from "./clientLog";
import { parseRoute, type Lookups } from "./route";
import { RunTimer, type TimerState } from "./timer";
import { RouteTracker } from "./tracker";

/** First zone of every new character; entering it later in the route means a new run. */
export const kStartArea = "1_1_1";
const kStartTown = "1_1_town"; // Lioneye's Watch, next to the Twilight Strand
/** Route steps a run must be past before entering kStartArea counts as a new run. */
const kNewRunMinCursor = 3;

export interface CharacterProgress {
  className: string | null;
  level: number | null;
  cursor: number;
  timer: TimerState;
  /** when this snapshot was taken: the timer is paused from then until the character is back */
  savedAt: number;
}

export interface ProgressData {
  version: 1;
  current: string | null;
  characters: Record<string, CharacterProgress>;
}

/**
 * Everything that follows a play session: where the player is, which character, the route
 * position and the timers. Pure logic (no Electron), so it can be tested end to end.
 *
 * Characters: Client.txt only names the character on level-ups, so a level-up from a different
 * character is what switches the saved progress. Entering the Twilight Strand when the run is
 * already past the start means a new character: route and timers restart on their own.
 */
export class Session {
  tracker!: RouteTracker;
  readonly timer = new RunTimer();
  areaId: string | null = null;
  areaName: string | null = null;
  characterName: string | null = null;
  className: string | null = null;
  characterLevel: number | null = null;
  private characters: Record<string, CharacterProgress> = {};
  /** set when a new run started and its character is not known yet (no level-up so far) */
  private freshRun = false;

  constructor(
    private readonly lookups: Lookups,
    private readonly routeTexts: string[],
    leagueStart: boolean,
  ) {
    this.rebuild(leagueStart);
  }

  /** (Re)builds the route, e.g. when the league-start option changes. Keeps the current zone. */
  rebuild(leagueStart: boolean): void {
    const defines = new Set<string>(leagueStart ? ["LEAGUE_START"] : []);
    const steps = this.routeTexts.flatMap((t) => parseRoute(t, this.lookups, defines));
    this.tracker = new RouteTracker(steps, (id) => this.lookups.areas[id]?.is_town_area ?? false);
    if (this.areaId && this.lookups.areas[this.areaId]) this.tracker.syncTo(this.areaId);
  }

  reset(): void {
    this.tracker.reset();
    this.timer.reset();
  }

  // ---- persistence ------------------------------------------------------------

  private snapshot(now: number): CharacterProgress {
    return {
      className: this.className,
      level: this.characterLevel,
      cursor: this.tracker.cursor,
      timer: this.timer.getState(),
      savedAt: now,
    };
  }

  exportProgress(now: number = Date.now()): ProgressData {
    const characters = { ...this.characters };
    if (this.characterName) characters[this.characterName] = this.snapshot(now);
    return { version: 1, current: this.characterName, characters };
  }

  importProgress(data: ProgressData, now: number = Date.now()): void {
    if (data?.version !== 1) return;
    this.characters = { ...data.characters };
    const cur = data.current ? this.characters[data.current] : undefined;
    if (data.current && cur) this.restore(data.current, cur, now);
  }

  private restore(name: string, p: CharacterProgress, now: number): void {
    this.characterName = name;
    this.className = p.className;
    this.characterLevel = p.level;
    this.tracker.reset();
    this.tracker.setCursor(p.cursor);
    this.timer.resume(p.timer, p.savedAt, now);
  }

  // ---- events -----------------------------------------------------------------

  private onLevelUp(ev: { character: string; className: string; level: number }, now: number): void {
    if (ev.character !== this.characterName) {
      const prev = this.characterName;
      if (prev) this.characters[prev] = this.snapshot(now);
      const saved = this.characters[ev.character];
      if (this.freshRun || !prev) {
        // the run in progress belongs to this character (a new run that just started, or the
        // first character seen since the app started): keep it
      } else if (saved) {
        this.restore(ev.character, saved, now);
      } else if (ev.level <= 2 && this.tracker.cursor > kNewRunMinCursor) {
        this.reset(); // a brand new character we did not see entering the game
      }
      // else: an existing character we never saw before: keep the current route, it re-anchors
      // on the next zone change anyway
      this.characterName = ev.character;
    }
    this.freshRun = false;
    this.className = ev.className;
    this.characterLevel = ev.level;
  }

  private onNewRun(now: number): void {
    if (this.characterName) this.characters[this.characterName] = this.snapshot(now);
    this.reset();
    this.characterName = null;
    this.className = null;
    this.characterLevel = 1;
    this.freshRun = true;
  }

  /** Live event. Returns true when visible state may have changed. */
  apply(ev: LogEvent, now: number = Date.now()): boolean {
    switch (ev.type) {
      case "area": {
        const ts = ev.ts ?? now;
        // walking back from Lioneye's Watch is not a new character; logging one in is
        if (ev.areaId === kStartArea && this.areaId !== kStartTown && this.tracker.cursor > kNewRunMinCursor) {
          this.onNewRun(ts);
        }
        this.areaId = ev.areaId;
        const info = this.lookups.areas[ev.areaId];
        this.areaName = info?.name ?? ev.areaId;
        if (info) {
          this.tracker.onArea(ev.areaId);
          this.timer.onArea(info.act, ts);
        } // hideouts / maps are not part of the campaign route
        return true;
      }
      case "enter":
        this.areaName = ev.name;
        return true;
      case "levelup":
        this.onLevelUp(ev, ev.ts ?? now);
        return true;
      case "death":
      case "focus":
      case "passive":
      case "npc":
        return false;
    }
  }

  applyLine(line: string, now: number = Date.now()): boolean {
    const ev = parseLine(line);
    return ev ? this.apply(ev, now) : false;
  }

  /** Startup: learn where the player is from the tail of an existing Client.txt (no timers). */
  backfill(lines: string[], now: number = Date.now()): void {
    let lastArea: string | null = null;
    let enteredName: string | null = null; // "You have entered X." after the last area line
    for (const l of lines) {
      const ev = parseLine(l);
      if (!ev) continue;
      if (ev.type === "area") {
        lastArea = ev.areaId;
        enteredName = null;
      } else if (ev.type === "enter") enteredName = ev.name;
      else if (ev.type === "levelup") this.onLevelUp(ev, now);
    }
    if (!lastArea) return;
    this.areaId = lastArea;
    const info = this.lookups.areas[lastArea];
    this.areaName = info?.name ?? enteredName ?? lastArea;
    if (!info) return;
    // restored progress: move relative to it; nothing known: anchor anywhere in the route
    if (this.tracker.cursor > 0) this.tracker.onArea(lastArea);
    else this.tracker.syncTo(lastArea);
  }
}
