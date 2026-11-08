import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { availableSupports, sourceText, type GemInfo, type QuestInfo } from "../src/core/gemAvailability";

const data = path.resolve(__dirname, "../data/json");
const gems: Record<string, GemInfo> = JSON.parse(fs.readFileSync(path.join(data, "gems.json"), "utf8"));
const quests: Record<string, QuestInfo> = JSON.parse(fs.readFileSync(path.join(data, "quests.json"), "utf8"));

describe("availableSupports (real exile-leveling data)", () => {
  it("a level 4 Witch in act 1 can already buy Arcane Surge from Nessa", () => {
    const a = availableSupports(gems, quests, "Witch", 1, 4);
    const surge = a.find((g) => g.name === "Arcane Surge");
    expect(surge?.source).toMatchObject({ kind: "vendor", npc: "Nessa", act: 1 });
    expect(a.every((g) => g.requiredLevel <= 4)).toBe(true);
    expect(sourceText(surge!.source)).toContain("Nessa");
  });

  it("respects class, act and level", () => {
    const early = availableSupports(gems, quests, "Witch", 1, 10).map((g) => g.id);
    const later = availableSupports(gems, quests, "Witch", 3, 30).map((g) => g.id);
    expect(later.length).toBeGreaterThan(early.length);
    for (const id of early) expect(later).toContain(id);
    const marauder = availableSupports(gems, quests, "Marauder", 1, 10).map((g) => g.id);
    expect(marauder).not.toEqual(early);
  });

  it("only returns support gems with names without the ' Support' suffix", () => {
    const a = availableSupports(gems, quests, "Ranger", 4, 40);
    expect(a.length).toBeGreaterThan(10);
    for (const g of a) {
      expect(gems[g.id].is_support).toBe(true);
      expect(g.name.endsWith(" Support")).toBe(false);
    }
  });
});
