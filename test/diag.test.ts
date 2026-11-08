import { describe, expect, it } from "vitest";
import { parseLine } from "../src/core/clientLog";
import { describeEvent, diagReport } from "../src/core/diag";

const campaign = (id: string) => ({ "1_1_2": { name: "The Coast", act: 1 }, "1_1_town": { name: "Lioneye's Watch", act: 1 } })[id];
const d = (line: string) => {
  const ev = parseLine(line);
  return ev ? describeEvent(ev, campaign) : null;
};
const gen = (id: string, level: number) => `2026/11/08 12:00:00 1 a [DEBUG Client 1] Generating level ${level} area "${id}" with seed 42`;
const info = (s: string) => `2026/11/08 12:00:00 1 a [INFO Client 1] ${s}`;

describe("describeEvent", () => {
  it("classifies areas", () => {
    expect(d(gen("MapWorldsStrand", 83))?.text).toBe("mapa: MapWorldsStrand (nível 83, T16, instância 42)");
    expect(d(gen("MavenBoss", 84))?.text).toContain("arena de boss: maven");
    expect(d(gen("MapWorldsPrimordialBoss4", 85))?.text).toContain("arena de boss: uber-eater");
    expect(d(gen("1_1_2", 2))?.text).toBe("campanha: The Coast (Ato 1, 1_1_2)");
    expect(d(gen("1_1_town", 1))?.text).toBe("hideout/cidade: Lioneye's Watch");
    expect(d(gen("HideoutCourts", 60))?.text).toBe("hideout/cidade: HideoutCourts");
    expect(d(gen("AbyssLeagueBoss2", 83))?.text).toBe("outra área: AbyssLeagueBoss2 (nível 83)");
  });

  it("describes character, game and passive lines", () => {
    expect(d(info(": Foo (Witch) is now level 12"))?.text).toBe("Foo (Witch) subiu para o nível 12");
    expect(d(info("[WINDOW] Lost focus"))).toEqual({ kind: "jogo", text: "jogo perdeu foco (alt-tab)" });
    expect(d(info("Closing game gracefully"))?.text).toContain("jogo fechou");
    expect(d(info("Successfully allocated passive skill id: life1, name: Life"))?.text).toBe("alocado: Life");
    expect(d(info("Successfully allocated passive skill id: atlas_path_1, name: Map Drop Chance"))).toBeNull();
  });

  it("builds a plain-text report", () => {
    const r = diagReport(["versão 0.1.0"], [{ ts: new Date(2026, 10, 8, 12, 0, 5).getTime(), kind: "jogo", text: "jogo ganhou foco" }]);
    expect(r).toContain("versão 0.1.0");
    expect(r).toMatch(/12:00:05 \[jogo\] jogo ganhou foco/);
  });
});
