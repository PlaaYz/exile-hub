// Client.txt: the tail at startup, the whole file in the background (boss runs, passives, maps of
// every session) and the live lines after that. The trackers that need the whole history live here.
import fs from "node:fs";
import readline from "node:readline";
import { BossRunTracker } from "../core/bossRuns";
import { candidateLogPaths, parseLine, type LogEvent } from "../core/clientLog";
import type { DiagKind } from "../core/diag";
import { GameSessionTracker } from "../core/gameSessions";
import { MapTracker } from "../core/maps";
import { PassiveTracker } from "../core/passives";
import { LogTailer } from "../core/tail";
import { kBackfillBytes } from "./env";

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
  private tailer: LogTailer | null = null;
  error: string | null = null;
  /** live events that arrive while the full scan is still reading the file */
  private queue: LogEvent[] | null = null;

  constructor(private readonly ctx: LogContext) {
    this.sessions = new GameSessionTracker(ctx.actOf);
  }

  get tailing(): boolean {
    return this.tailer !== null;
  }
  get fileSeen(): boolean {
    return !!this.tailer?.fileSeen;
  }

  static detect(): string | null {
    for (const p of candidateLogPaths()) {
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        /* next */
      }
    }
    return null;
  }

  stop(): void {
    this.tailer?.stop();
    this.tailer = null;
  }

  /** Starts following `file`; returns the tail lines for the caller's startup backfill. */
  start(file: string): string[] {
    this.stop();
    this.error = null;
    const tail = readTail(file);
    void this.scan(file);
    this.tailer = new LogTailer(file, (l) => this.onLine(l), {
      onError: (e) => {
        this.error = e.message;
        this.ctx.broadcast();
      },
    });
    this.tailer.start();
    return tail;
  }

  /** The whole Client.txt (a 27 MB log takes ~0.3 s), read in the background. */
  private async scan(file: string): Promise<void> {
    const runs = new BossRunTracker();
    const passives = new PassiveTracker();
    const maps = new MapTracker();
    const sessions = new GameSessionTracker(this.ctx.actOf);
    let lastLevelUp: LogEvent | null = null;
    this.queue = [];
    try {
      const size = fs.statSync(file).size;
      if (size > 0) {
        const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8", end: size - 1 }) });
        for await (const line of rl) {
          const ev = parseLine(line);
          if (!ev) continue;
          runs.feed(ev);
          passives.feed(ev);
          maps.feed(ev);
          sessions.feed(ev);
          if (ev.type === "levelup") lastLevelUp = ev;
        }
      }
    } catch (e) {
      console.error("log scan failed", e);
    }
    for (const ev of this.queue ?? []) {
      runs.feed(ev);
      passives.feed(ev);
      maps.feed(ev);
      sessions.feed(ev);
    }
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

/** The last kBackfillBytes of the file as lines (the first, probably cut, line dropped). */
function readTail(file: string): string[] {
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - kBackfillBytes);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString("utf8").split("\n");
      if (start > 0) lines.shift();
      return lines;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return []; // file missing: the tailer will wait for it
  }
}
