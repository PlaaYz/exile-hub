import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CH } from "../src/shared/ipc";

describe("preload / ipc channel sync", () => {
  const preload = fs.readFileSync(path.resolve(__dirname, "../src/main/preload.ts"), "utf8");
  // the handlers live in src/main/ipc.ts since the main process was split into modules
  const main = fs.readFileSync(path.resolve(__dirname, "../src/main/ipc.ts"), "utf8");

  it("preload uses every channel literal, and only known ones", () => {
    const used = new Set([...preload.matchAll(/(?:invoke|on|removeListener)\("([^"]+)"/g)].map((m) => m[1]));
    expect(used).toEqual(new Set(Object.values(CH)));
  });

  it("main registers a handler for every invoke channel", () => {
    for (const [key, ch] of Object.entries(CH)) {
      if (ch === CH.state) continue; // push channel
      expect(main.includes(`CH.${key}`), `main has no handler for CH.${key}`).toBe(true);
    }
  });
});
