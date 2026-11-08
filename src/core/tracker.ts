import type { Step, TrackerView } from "../shared/types";

/** How far ahead (in steps) an area transition may match at all. */
const FORWARD_WINDOW = 25;
/**
 * How many arrival markers the player may skip (e.g. took a waypoint instead of walking).
 * Kept small on purpose: a portal to town must not teleport the cursor to a later town visit.
 */
const MAX_SKIPPED_MARKERS = 1;

/**
 * Follows the player along the route. A step with an `arrival` area is a "you arrive here"
 * marker; everything between two markers is "what to do in this area".
 */
export class RouteTracker {
  cursor = 0;
  areaId: string | null = null;
  offRoute = false;

  constructor(
    readonly steps: Step[],
    private readonly isTown: (areaId: string) => boolean = () => false,
  ) {}

  /** Area of the marker that opened the current block (the last arrival before the cursor). */
  private currentBlockArea(): string | undefined {
    for (let i = Math.min(this.cursor, this.steps.length) - 1; i >= 0; i--) {
      const a = this.steps[i].arrival;
      if (a !== undefined) return a;
    }
    return undefined;
  }

  reset(): void {
    this.cursor = 0;
    this.areaId = null;
    this.offRoute = false;
  }

  /** Call when the client generates / enters an area. */
  onArea(areaId: string): void {
    this.areaId = areaId;
    const n = this.steps.length;

    // 1. the zone we are already in (e.g. coming back through a portal): nothing to do
    if (this.currentBlockArea() === areaId) {
      this.offRoute = false;
      return;
    }

    // 2. the next marker, or one marker further if a zone was skipped
    const end = Math.min(n, this.cursor + FORWARD_WINDOW);
    let skipped = 0;
    for (let i = this.cursor; i < end; i++) {
      const a = this.steps[i].arrival;
      if (a === undefined) continue;
      if (a === areaId) {
        this.cursor = i + 1;
        this.offRoute = false;
        return;
      }
      if (++skipped > MAX_SKIPPED_MARKERS) break;
    }

    // 3. a town visit that the route does not expect right now (portal): keep our place
    if (this.isTown(areaId)) {
      this.offRoute = false;
      return;
    }

    // 4. the player went back to an earlier zone: rewind to it
    for (let i = Math.min(this.cursor, n) - 1; i >= 0; i--) {
      if (this.steps[i].arrival === areaId) {
        this.cursor = i + 1;
        this.offRoute = false;
        return;
      }
    }

    // 5. a zone much further ahead (skipped a lot, switched character, app started late): jump
    //    there on our own. If it was a detour, coming back to the expected zone rewinds (rule 4).
    for (let i = this.cursor; i < n; i++) {
      if (this.steps[i].arrival === areaId) {
        this.cursor = i + 1;
        this.offRoute = false;
        return;
      }
    }
    this.offRoute = true; // a campaign zone the route never visits
  }

  /**
   * Re-anchor on an area when the position is unknown (app started mid-run, or the player
   * wandered off-route): jump to the first place the route actually enters that area.
   */
  syncTo(areaId: string): boolean {
    this.areaId = areaId;
    let fallback = -1;
    for (let i = 0; i < this.steps.length; i++) {
      const s = this.steps[i];
      if (s.arrival !== areaId) continue;
      if (s.fragments.some((f) => f.kind === "enter" && f.areaId === areaId)) {
        this.cursor = i + 1;
        this.offRoute = false;
        return true;
      }
      if (fallback === -1) fallback = i;
    }
    if (fallback !== -1) {
      this.cursor = fallback + 1;
      this.offRoute = false;
      return true;
    }
    return false;
  }

  setCursor(i: number): void {
    this.cursor = Math.max(0, Math.min(this.steps.length, i));
  }

  /** Manual controls: jump to the next / previous arrival marker. */
  nextBlock(): void {
    for (let i = this.cursor; i < this.steps.length; i++) {
      if (this.steps[i].arrival !== undefined) {
        this.setCursor(i + 1);
        return;
      }
    }
    this.setCursor(this.steps.length);
  }

  prevBlock(): void {
    // find the marker that opened the current block, then the one before it
    let seen = 0;
    for (let i = this.cursor - 1; i >= 0; i--) {
      if (this.steps[i].arrival !== undefined) {
        seen++;
        if (seen === 2) {
          this.setCursor(i + 1);
          return;
        }
      }
    }
    this.setCursor(0);
  }

  view(): TrackerView {
    const n = this.steps.length;
    const done = this.cursor >= n;
    let nextIdx = -1;
    for (let j = this.cursor; j < n; j++) {
      if (this.steps[j].arrival !== undefined) {
        nextIdx = j;
        break;
      }
    }
    const blockEnd = nextIdx === -1 ? n : nextIdx;
    const ref = this.steps[Math.min(this.cursor, n - 1)];
    return {
      cursor: this.cursor,
      total: n,
      areaId: this.areaId,
      offRoute: this.offRoute,
      act: ref ? ref.act : 0,
      block: this.steps.slice(this.cursor, blockEnd),
      next: nextIdx === -1 ? null : this.steps[nextIdx],
      done,
    };
  }
}
