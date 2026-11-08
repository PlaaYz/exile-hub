// Client.txt: the tail at startup, the whole file in the background (boss runs, passives, maps and
// play sessions of the whole history) and the live lines after that.
import { BossRunTracker } from "../core/bossRuns";
import { parseLine, type LogEvent } from "../core/clientLog";
import type { DiagKind } from "../core/diag";
import { GameSessionTracker } from "../core/gameSessions";
import { MapTracker } from "../core/maps";
import { PassiveTracker } from "../core/passives";
import { kBackfillBytes } from "./constants";
import type { LogFollower, Platform } from "./platform";

export interface LogContext {
  /** a parsed live line, after the trackers saw it */
  onEvent(ev: LogEvent): void;
  /** any live line (parsed or not), for the diagnostics heartbeat */
  onRawLine(): void;
  /** a parsed live line, before the trackers (diagnostics describe it first) */
  onParsed(ev: LogEvent): void;
  /** the full scan finished; lastLevelUp = the newest level-up in the whole log */
  onScanDone(lastLevelUp: LogEvent | null): void;
  addDiag(kind: DiagKind, text: string): void;
  broadcast(): void;
  /** campaign act of an area id (null for maps, hideouts...), for the session summaries */
  actOf(areaId: string): number | null;
}

export class LogService {
  bossRuns = new BossRunTracker();
  passives = new PassiveTracker();
  maps = new MapTracker();
  sessions: GameSessionTracker;
  private follower: LogFollower | null = null;
  error: string | null = null;
  /** live events that arrive while the full scan is still reading the file */
  private queue: LogEvent[] | null = null;

  constructor(
    private readonly platform: Platform,
    private readonly ctx: LogContext,
  ) {
    this.sessions = new GameSessionTracker(ctx.actOf);
  }

  get fileSeen(): boolean {
    return !!this.follower?.fileSeen;
  }

  stop(): void {
    this.follower?.stop();
    this.follower = null;
  }

  /** Starts following `file`; returns the tail lines for the caller's startup backfill. */
  async start(file: string): Promise<string[]> {
    this.stop();
    this.error = null;
    const tail = await this.platform.readLogTail(file, kBackfillBytes);
    void this.scan(file);
    this.follower = this.platform.followLog(
      file,
      (l) => this.onLine(l),
      (e) => {
        this.error = e.message;
        this.ctx.broadcast();
      },
    );
    return tail;
  }

  /** The whole Client.txt (a 27 MB log takes well under a second), read in the background. */
  private async scan(file: string): Promise<void> {
    const runs = new BossRunTracker();
    const passives = new PassiveTracker();
    const maps = new MapTracker();
    const sessions = new GameSessionTracker(this.ctx.actOf);
    let lastLevelUp: LogEvent | null = null;
    this.queue = [];
    const feed = (ev: LogEvent) => {
      runs.feed(ev);
      passives.feed(ev);
      maps.feed(ev);
      sessions.feed(ev);
    };
    try {
      await this.platform.scanLog(file, (lines) => {
        for (const line of lines) {
          const ev = parseLine(line);
          if (!ev) continue;
          feed(ev);
          if (ev.type === "levelup") lastLevelUp = ev;
        }
      });
    } catch (e) {
      console.error("log scan failed", e);
    }
    for (const ev of this.queue ?? []) feed(ev);
    this.queue = null;
    this.bossRuns = runs;
    this.passives = passives;
    this.maps = maps;
    this.sessions = sessions;
    this.ctx.addDiag(
      "app",
      `log completo lido: ${maps.runs.length} mapas, ${runs.runs.length} runs de boss, personagens com passivos: ${passives.characters().length}`,
    );
    this.ctx.onScanDone(lastLevelUp);
    this.ctx.broadcast();
  }

  private onLine(line: string): void {
    this.ctx.onRawLine();
    const ev = parseLine(line);
    if (!ev) return;
    this.ctx.onParsed(ev);
    if (this.queue) this.queue.push(ev);
    else {
      const bossBefore = this.bossRuns.runs.length;
      const mapsBefore = this.maps.runs.length;
      const a = this.bossRuns.feed(ev);
      const b = this.passives.feed(ev);
      const c = this.maps.feed(ev);
      const d = this.sessions.feed(ev);
      if (this.bossRuns.runs.length > bossBefore) {
        this.ctx.addDiag("boss", `run de boss começou: ${this.bossRuns.runs[this.bossRuns.runs.length - 1].boss}`);
      }
      if (this.maps.runs.length > mapsBefore) this.ctx.addDiag("mapa", `novo mapa (#${this.maps.runs.length} no log)`);
      if (a || b || c || d) this.ctx.broadcast();
    }
    this.ctx.onEvent(ev);
  }
}
