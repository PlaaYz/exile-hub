// Client-side limiter that honours GGG's X-Rate-Limit-* headers.
// Rule format: "max:periodSeconds:penaltySeconds,max:period:penalty,..."
// State format: "current:periodSeconds:restrictedSeconds,..."

export interface Rule {
  max: number;
  period: number;
  penalty: number;
}
export interface RuleState {
  hits: number;
  period: number;
  restricted: number;
}

function parseTriples(h: string | null | undefined): number[][] {
  if (!h) return [];
  return h
    .split(",")
    .map((part) => part.trim().split(":").map(Number))
    .filter((p) => p.length === 3 && p.every((n) => Number.isFinite(n)));
}

export function parseRules(h: string | null | undefined): Rule[] {
  return parseTriples(h).map(([max, period, penalty]) => ({ max, period, penalty }));
}

export function parseState(h: string | null | undefined): RuleState[] {
  return parseTriples(h).map(([hits, period, restricted]) => ({ hits, period, restricted }));
}

export interface LimiterHeaders {
  rules?: string | null;
  state?: string | null;
  retryAfter?: string | null;
}

export interface LimiterClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const defaultClock: LimiterClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export class RateLimiter {
  private rules: Rule[] = [];
  private stamps: number[] = [];
  private blockedUntil = 0;
  private chain: Promise<void> = Promise.resolve();

  /** @param margin requests kept free below each rule's max, as a safety buffer */
  constructor(
    private readonly clock: LimiterClock = defaultClock,
    private readonly margin = 1,
  ) {}

  update(h: LimiterHeaders): void {
    const now = this.clock.now();
    const rules = parseRules(h.rules);
    if (rules.length) this.rules = rules;
    const states = parseState(h.state);
    for (const s of states) {
      if (s.restricted > 0) this.blockedUntil = Math.max(this.blockedUntil, now + s.restricted * 1000);
    }
    // the server's own count wins: requests made before an app restart (or by another program on this
    // IP) count too. The missing ones are dated just before the shorter windows, so they fill this
    // window without clogging the short ones (shortest rule first: its missing ones are recent).
    const pairs = states.map((s, i) => [s, this.rules[i]] as const).filter(([s, r]) => r && s.period === r.period);
    pairs.sort((a, b) => a[1].period - b[1].period);
    let shorter = 0; // longest period already handled, in seconds
    for (const [s, r] of pairs) {
      const local = this.stamps.filter((t) => t > now - r.period * 1000).length;
      const at = shorter ? now - shorter * 1000 - 1 : now;
      for (let k = local; k < Math.min(s.hits, r.max); k++) this.stamps.push(at);
      shorter = r.period;
    }
    this.stamps.sort((a, b) => a - b);
    const retry = Number(h.retryAfter);
    if (h.retryAfter && Number.isFinite(retry) && retry > 0) {
      this.blockedUntil = Math.max(this.blockedUntil, now + retry * 1000);
    }
  }

  /** Milliseconds to wait before another request is allowed (0 = go). */
  waitMs(): number {
    const now = this.clock.now();
    let wait = Math.max(0, this.blockedUntil - now);
    for (const r of this.rules) {
      const limit = Math.max(1, r.max - this.margin);
      const windowStart = now - r.period * 1000;
      const inWindow = this.stamps.filter((t) => t > windowStart);
      if (inWindow.length >= limit) {
        const releasing = inWindow[inWindow.length - limit];
        wait = Math.max(wait, releasing + r.period * 1000 - now);
      }
    }
    return wait;
  }

  /** Share of the fullest rule already used (0..1): background work backs off well before the limit. */
  usage(): number {
    const now = this.clock.now();
    let used = 0;
    for (const r of this.rules) {
      const n = this.stamps.filter((t) => t > now - r.period * 1000).length;
      used = Math.max(used, n / r.max);
    }
    return used;
  }

  /** Resolves when it is safe to send one request; calls are served in order. */
  acquire(): Promise<void> {
    const run = async (): Promise<void> => {
      for (;;) {
        const w = this.waitMs();
        if (w <= 0) break;
        await this.clock.sleep(w + 5);
      }
      const now = this.clock.now();
      this.stamps.push(now);
      const maxPeriod = Math.max(0, ...this.rules.map((r) => r.period)) * 1000;
      this.stamps = this.stamps.filter((t) => t > now - maxPeriod);
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
