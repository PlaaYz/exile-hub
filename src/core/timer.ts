import type { TimerSnapshot } from "../shared/types";

export interface TimerState {
  runStart: number;
  lastAct: number | null;
  actStart: number;
  splits: Record<number, number>;
}

/** Per-act split timer driven by area events (timestamps in ms). */
export class RunTimer {
  private runStart = 0;
  private lastAct: number | null = null;
  private actStart = 0;
  private splits: Record<number, number> = {};

  getState(): TimerState {
    return { runStart: this.runStart, lastAct: this.lastAct, actStart: this.actStart, splits: { ...this.splits } };
  }

  setState(s: TimerState): void {
    this.runStart = s.runStart;
    this.lastAct = s.lastAct;
    this.actStart = s.actStart;
    this.splits = { ...s.splits };
  }

  /** Resume a paused timer: the time between `pausedAt` and `now` does not count. */
  resume(s: TimerState, pausedAt: number, now: number): void {
    this.setState(s);
    const gap = Math.max(0, now - pausedAt);
    if (this.runStart) this.runStart += gap;
    if (this.lastAct !== null) this.actStart += gap;
  }

  reset(): void {
    this.runStart = 0;
    this.lastAct = null;
    this.actStart = 0;
    this.splits = {};
  }

  onArea(act: number, now: number): void {
    if (act <= 0) return;
    if (this.runStart === 0) this.runStart = now;
    if (this.lastAct === null) {
      this.lastAct = act;
      this.actStart = now;
      return;
    }
    if (act !== this.lastAct) {
      this.splits[this.lastAct] = (this.splits[this.lastAct] ?? 0) + (now - this.actStart);
      this.lastAct = act;
      this.actStart = now;
    }
  }

  snapshot(now: number): TimerSnapshot {
    const act = this.lastAct;
    const actMs = act === null ? 0 : (this.splits[act] ?? 0) + Math.max(0, now - this.actStart);
    return {
      runMs: this.runStart ? Math.max(0, now - this.runStart) : 0,
      act,
      actMs,
      splits: { ...this.splits },
    };
  }
}
