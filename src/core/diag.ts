// Diagnostics: a short, human-readable line (pt-BR) for every event the app understood, so the
// owner can play for a few minutes and see / send what the app saw.
import { arenaOf, kUberLevel } from "./bossRuns";
import type { LogEvent } from "./clientLog";
import { isHideoutOrTown, isMapArea, mapTier } from "./maps";
import { isCharacterPassiveId } from "./passives";

export type DiagKind = "zona" | "personagem" | "jogo" | "passivo" | "mapa" | "boss" | "overlay" | "clipboard" | "preço" | "comando" | "app";

export interface DiagEntry {
  ts: number;
  kind: DiagKind;
  text: string;
}

export const kDiagMax = 150;

export interface CampaignArea {
  name: string;
  act: number;
}

/** What the log line means, or null for events not worth a line. */
export function describeEvent(ev: LogEvent, campaign: (id: string) => CampaignArea | undefined): Omit<DiagEntry, "ts"> | null {
  switch (ev.type) {
    case "area": {
      const id = ev.areaId;
      const arena = arenaOf(id);
      if (arena) {
        const uber = ev.areaLevel >= kUberLevel && arena.uber;
        return { kind: "zona", text: `arena de boss: ${uber ? arena.uber : arena.boss} (${id}, nível ${ev.areaLevel})` };
      }
      if (isMapArea(id)) {
        return { kind: "zona", text: `mapa: ${id} (nível ${ev.areaLevel}, T${mapTier(ev.areaLevel)}, instância ${ev.seed})` };
      }
      const c = campaign(id);
      if (c && !isHideoutOrTown(id)) return { kind: "zona", text: `campanha: ${c.name} (Ato ${c.act}, ${id})` };
      if (isHideoutOrTown(id)) return { kind: "zona", text: `hideout/cidade: ${c?.name ?? id}` };
      return { kind: "zona", text: `outra área: ${id} (nível ${ev.areaLevel})` };
    }
    case "enter":
      return { kind: "zona", text: `"You have entered ${ev.name}"` };
    case "levelup":
      return { kind: "personagem", text: `${ev.character} (${ev.className}) subiu para o nível ${ev.level}` };
    case "death":
      return { kind: "personagem", text: `morte: ${ev.character}` };
    case "focus":
      if (ev.closing) return { kind: "jogo", text: "jogo fechou (ou iniciou de novo)" };
      return { kind: "jogo", text: ev.focused ? "jogo ganhou foco" : "jogo perdeu foco (alt-tab)" };
    case "passive":
      if (!isCharacterPassiveId(ev.skillId)) return null; // Atlas / Genesis: noise here
      return { kind: "passivo", text: `${ev.allocated ? "alocado" : "removido"}: ${ev.name}` };
    case "npc":
      return { kind: "mapa", text: `mecânica: ${ev.mechanic} (${ev.speaker} falou)` };
    case "whisper":
      return null; // private: only the sender's name is kept, for "/invite {last_whisper}"
  }
}

/** Plain-text report for "Copiar relatório". */
export function diagReport(header: string[], entries: DiagEntry[]): string {
  const time = (ts: number) => new Date(ts).toLocaleTimeString("pt-BR");
  return [
    "=== Exile Hub — diagnóstico ===",
    ...header,
    "",
    ...entries.map((e) => `${time(e.ts)} [${e.kind}] ${e.text}`),
  ].join("\n");
}
