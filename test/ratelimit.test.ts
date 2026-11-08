import { describe, expect, it } from "vitest";
import { RateLimiter, parseRules, parseState } from "../src/core/ratelimit";

function fakeClock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
    advance: (ms: number) => (t += ms),
  };
}

describe("rate limit headers", () => {
  it("parses rules and state", () => {
    expect(parseRules("12:6:60,16:12:300")).toEqual([
      { max: 12, period: 6, penalty: 60 },
      { max: 16, period: 12, penalty: 300 },
    ]);
    expect(parseState("1:6:0,3:12:30")).toEqual([
      { hits: 1, period: 6, restricted: 0 },
      { hits: 3, period: 12, restricted: 30 },
    ]);
    expect(parseRules(null)).toEqual([]);
    expect(parseRules("garbage")).toEqual([]);
  });
});

describe("RateLimiter", () => {
  it("lets requests through until the (max - margin) budget is used, then waits", async () => {
    const c = fakeClock();
    const rl = new RateLimiter(c, 1);
    rl.update({ rules: "3:10:60" }); // effective limit 2 per 10s
    await rl.acquire();
    await rl.acquire();
    expect(c.sleeps).toEqual([]);
    expect(rl.waitMs()).toBeGreaterThan(9000);
    await rl.acquire(); // must sleep ~10s
    expect(c.sleeps.length).toBeGreaterThan(0);
    expect(c.sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10000);
  });

  it("respects restriction reported in the state header", async () => {
    const c = fakeClock();
    const rl = new RateLimiter(c, 0);
    rl.update({ rules: "10:10:60", state: "10:10:30" });
    expect(rl.waitMs()).toBe(30000);
    await rl.acquire();
    expect(c.sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(30000);
  });

  it("respects Retry-After", () => {
    const c = fakeClock();
    const rl = new RateLimiter(c);
    rl.update({ retryAfter: "7" });
    expect(rl.waitMs()).toBe(7000);
  });

  it("window slides: old requests stop counting", async () => {
    const c = fakeClock();
    const rl = new RateLimiter(c, 0);
    rl.update({ rules: "2:5:60" });
    await rl.acquire();
    await rl.acquire();
    expect(rl.waitMs()).toBeGreaterThan(0);
    c.advance(5001);
    expect(rl.waitMs()).toBe(0);
  });

  it("serves concurrent callers in order", async () => {
    const c = fakeClock();
    const rl = new RateLimiter(c, 0);
    rl.update({ rules: "1:2:60" });
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => rl.acquire().then(() => order.push(n))));
    expect(order).toEqual([1, 2, 3]);
  });
});
