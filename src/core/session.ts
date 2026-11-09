import { parseLine, type LogEvent } from "./clientLog";
import { isHideoutOrTown, isMapArea } from "./maps";
import { parseRoute, type Lookups } from "./route";
import { RunTimer, type TimerState } from "./timer";
import { RouteTracker } from "./tracker";

/** First zone of every new character; entering it later in the route means a new run. */
export const kStartArea = "1_1_1";
const kStartTown = "1_1_town"; // Lioneye's Watch, next to the Twilight Strand
/** A character is never in an area more than this many levels above its own (under-leveled campaign included). */
export const kLevelSlack = 15;
/** The campaign ends with act 10; the zone data's act 11 is the endgame town (Karui Shores). */
export const kLastCampaignAct = 10;
/** Non-campaign areas from this level up are endgame (maps start at 68). */
export const kEndgameAreaLevel = 68;
/** Route steps a run must be past before entering kStartArea counts as a new run. */
const kNewRunMinCursor = 3;

export interface CharacterProgress {
  className: string | null;
  level: number | null;
  cursor: number;
  timer: TimerState;
  /** when this snapshot was taken: the timer is paused from then until the character is back */
  savedAt: number;
  /** the area the character was in: it logs back in there (used to tell who logged in) */
  lastArea?: string;
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
  /**
   * The player is in endgame content (a map, or a non-campaign area of level 68+): an endgame
   * character, which the log does not name until it levels up. The campaign route is paused until
   * a campaign zone is entered again.
   */
  endgame = false;
  private characters: Record<string, CharacterProgress> = {};
  /** set when a new run started and its character is not known yet (no level-up so far) */
  private freshRun = false;
  /** a login just happened: the next area tells where that character is */
  private loginPending = false;
  /**
   * The account's own characters with their last known class/level (every level-up in the whole
   * log). Set by the app once the full log is read; other players never level up in this log.
   */
  known: (name: string) => { className: string; level: number } | undefined = () => undefined;

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
      lastArea: this.areaId ?? undefined,
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
    this.fillFromKnown();
  }

  /** The log's latest level-up of this character is newer than anything saved: use its level. */
  private fillFromKnown(): void {
    const k = this.characterName ? this.known(this.characterName) : undefined;
    if (!k) return;
    this.className = k.className;
    if (this.characterLevel === null || k.level > this.characterLevel) this.characterLevel = k.level;
  }

  /**
   * "X has been slain": when X is one of the account's own characters (known from level-ups) and
   * not the one we think is playing, X is who is playing (a switch the log did not name).
   */
  private onDeath(name: string, now: number): boolean {
    if (name === this.characterName || !this.known(name)) return false;
    this.identify(name, now);
    return true;
  }

  /** This known character is the one playing (its saved progress comes back). */
  identify(name: string, now: number = Date.now()): void {
    if (name === this.characterName) return;
    if (this.characterName) this.characters[this.characterName] = this.snapshot(now);
    const saved = this.characters[name];
    if (saved) this.restore(name, saved, now);
    else {
      this.characterName = name;
      this.className = null;
      this.characterLevel = null;
      this.fillFromKnown();
    }
    this.freshRun = false;
    this.loginPending = false;
  }

  /** Called when the whole log was read: the current character's level may be known now. */
  refreshFromKnown(): void {
    this.fillFromKnown();
  }

  // ---- events -----------------------------------------------------------------

  /**
   * Login server connection: game start or back to character select. Whoever logs in is unknown
   * until a level-up names them; the first area may already tell (see onFirstAreaAfterLogin).
   */
  private onLogin(now: number): void {
    if (this.characterName) this.characters[this.characterName] = this.snapshot(now);
    this.characterName = null;
    this.className = null;
    this.characterLevel = null;
    this.freshRun = false;
    this.loginPending = true;
  }

  /**
   * A character logs in where it logged out: if exactly one known character left the game in this
   * area (hideouts are shared by the whole account: no clue there) and its level fits, it is them.
   */
  private onFirstAreaAfterLogin(areaId: string, areaLevel: number, now: number): void {
    this.loginPending = false;
    if (isHideoutOrTown(areaId) && !this.lookups.areas[areaId]) return; // hideout / endgame town
    const here = Object.entries(this.characters).filter(
      ([, p]) => p.lastArea === areaId && (p.level === null || areaLevel <= p.level + kLevelSlack),
    );
    if (here.length === 1) this.restore(here[0][0], here[0][1], now);
  }

  /**
   * The known character cannot be in an area this far above its level: another character is
   * playing (switched without a login line we saw). Forget who it is until a level-up says.
   * Its saved progress is left alone: what happened since belongs to someone else.
   */
  private checkLevelFits(areaId: string, areaLevel: number): void {
    const lvl = this.characterLevel;
    if (!this.characterName || lvl === null || /^Hideout/.test(areaId)) return;
    if (areaLevel > lvl + kLevelSlack) {
      this.characterName = null;
      this.className = null;
      this.characterLevel = null;
    }
  }

  private onLevelUp(ev: { character: string; className: string; level: number }, now: number): void {
    if (ev.character !== this.characterName) {
      const prev = this.characterName;
      if (prev) this.characters[prev] = this.snapshot(now);
      const saved = this.characters[ev.character];
      if (this.freshRun) {
        // the run in progress belongs to this character (a new run that just started): keep it
      } else if (saved) {
        this.restore(ev.character, saved, now);
      } else if (!prev) {
        // the first character seen (app start, or after a login we could not attribute): keep the route
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
        if (this.loginPending) this.onFirstAreaAfterLogin(ev.areaId, ev.areaLevel, ts);
        this.checkLevelFits(ev.areaId, ev.areaLevel);
        const known = this.lookups.areas[ev.areaId];
        this.areaName = known?.name ?? ev.areaId;
        // the zone data also has "act 11" (Karui Shores, the endgame town): only acts 1-10 are campaign
        const info = known && known.act <= kLastCampaignAct ? known : undefined;
        // hideouts/towns say nothing about which kind of character is playing
        if (info) this.endgame = false;
        else if (known || (!isHideoutOrTown(ev.areaId) && (isMapArea(ev.areaId) || ev.areaLevel >= kEndgameAreaLevel))) this.endgame = true;
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
      case "login":
        this.onLogin(ev.ts ?? now);
        return true;
      case "death":
        return this.onDeath(ev.character, ev.ts ?? now);
      case "focus":
      case "passive":
      case "npc":
      case "whisper":
      case "join":
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
        this.areaId = ev.areaId; // snapshots taken at a later login must see where the character was
        if (this.loginPending) this.onFirstAreaAfterLogin(ev.areaId, ev.areaLevel, now);
        this.checkLevelFits(ev.areaId, ev.areaLevel);
      } else if (ev.type === "enter") enteredName = ev.name;
      else if (ev.type === "levelup") this.onLevelUp(ev, now);
      else if (ev.type === "login") this.onLogin(now);
      else if (ev.type === "death") this.onDeath(ev.character, now);
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
