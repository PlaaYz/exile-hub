import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseRoute, type Lookups } from "../src/core/route";
import { hasRouteTextPtBR, routeTextPtBR } from "../src/shared/routePtBR";

const data = path.resolve(__dirname, "../data");
const lookups: Lookups = {
  areas: JSON.parse(fs.readFileSync(path.join(data, "json/areas.json"), "utf8")),
  quests: JSON.parse(fs.readFileSync(path.join(data, "json/quests.json"), "utf8")),
};

describe("route pt-BR", () => {
  it("translates every free-text piece of the route", () => {
    const missing = new Set<string>();
    for (const defs of [new Set(["LEAGUE_START"]), new Set<string>()]) {
      for (let i = 1; i <= 10; i++) {
        const text = fs.readFileSync(path.join(data, `routes/act-${i}.txt`), "utf8");
        for (const step of parseRoute(text, lookups, defs)) {
          for (const frags of [step.fragments, ...step.subs]) {
            for (const f of frags) {
              if (f.kind === "text" && f.text.trim() && !hasRouteTextPtBR(f.text)) missing.add(f.text);
            }
          }
        }
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("falls back to the original text", () => {
    expect(routeTextPtBR("Hand in ")).toBe("Entregue ");
    expect(routeTextPtBR("something new")).toBe("something new");
  });
});
