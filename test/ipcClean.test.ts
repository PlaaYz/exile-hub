import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, cleanConfigPatch, cleanMapTradeOptions, cleanResearch } from "../src/app/ipcClean";

describe("renderer input validation", () => {
  it("accepts every user-facing setting with the right type", () => {
    expect(cleanConfigPatch({ chatCommandsEnabled: false })).toEqual({ chatCommandsEnabled: false });
    expect(cleanConfigPatch({ gemAdviceEnabled: false })).toEqual({}); // removed setting: ignored
    expect(cleanConfigPatch({ overlayEnabled: true, league: "Allflame", clientLogPath: null })).toEqual({
      overlayEnabled: true,
      league: "Allflame",
      clientLogPath: null,
    });
  });

  it("drops unknown keys, wrong types and internal keys", () => {
    expect(cleanConfigPatch({ hacked: 1, overlayEnabled: "yes", league: 3, dashboardDisplayId: 7 })).toEqual({});
    expect(cleanConfigPatch(null)).toEqual({});
  });

  it("every default setting is either user-settable or internal", () => {
    const settable = Object.keys(cleanConfigPatch({ ...DEFAULT_CONFIG, clientLogPath: "x", league: "y" }));
    const internal = ["dashboardDisplayId", "overlayPos"]; // only the app changes these
    expect(settable.sort()).toEqual(Object.keys(DEFAULT_CONFIG).filter((k) => !internal.includes(k)).sort());
  });

  it("cleans price re-search and map trade options", () => {
    expect(cleanResearch([{ statId: "a", enabled: true, min: 3 }, { statId: 1 }, null])).toEqual([{ statId: "a", enabled: true, min: 3 }]);
    expect(cleanResearch("x")).toEqual([]);
    const o = cleanMapTradeOptions({ exclude: ["phys-reflect", "nope"], minQuantity: 70.6, tierMin: 99, rarity: "evil" });
    expect(o).toMatchObject({ exclude: ["phys-reflect"], minQuantity: 71, tierMin: 17, rarity: "any", corrupted: "any" });
  });
});
