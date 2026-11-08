// Which support gems a character can get in the campaign by now: quest rewards and vendor gems
// for its class, from quests up to the current act, at or below its level (exile-leveling data).

export interface GemInfo {
  id: string;
  name: string;
  required_level: number;
  is_support: boolean;
  /** strength / dexterity / intelligence -> red / green / blue socket */
  primary_attribute?: string;
}

export interface QuestInfo {
  id: string;
  name: string;
  act: string;
  reward_offers?: Record<
    string,
    {
      quest_npc?: string;
      quest?: Record<string, { classes: string[] }>;
      vendor?: Record<string, { classes: string[]; npc?: string }>;
    }
  >;
}

export interface GemSource {
  act: number;
  quest: string;
  npc: string;
  kind: "quest" | "vendor";
}

export interface AvailableGem {
  id: string;
  name: string;
  requiredLevel: number;
  /** the earliest way to get it */
  source: GemSource;
}

export function availableSupports(
  gems: Record<string, GemInfo>,
  quests: Record<string, QuestInfo>,
  className: string,
  act: number,
  level: number,
): AvailableGem[] {
  const out = new Map<string, AvailableGem>();
  const qs = Object.values(quests).sort((a, b) => Number(a.act) - Number(b.act));
  for (const q of qs) {
    const qAct = Number(q.act);
    if (!Number.isFinite(qAct) || qAct > act) continue;
    for (const offer of Object.values(q.reward_offers ?? {})) {
      const add = (id: string, classes: string[], kind: "quest" | "vendor", npc: string) => {
        if (!classes.includes(className) || out.has(id)) return;
        const g = gems[id];
        if (!g || !g.is_support || g.required_level > level) return;
        out.set(id, {
          id,
          name: g.name.replace(/ Support$/, ""),
          requiredLevel: g.required_level,
          source: { act: qAct, quest: q.name, npc, kind },
        });
      };
      for (const [id, r] of Object.entries(offer.quest ?? {})) add(id, r.classes, "quest", offer.quest_npc ?? "");
      for (const [id, r] of Object.entries(offer.vendor ?? {})) add(id, r.classes, "vendor", r.npc ?? "");
    }
  }
  return [...out.values()];
}

export function sourceText(s: GemSource): string {
  return s.kind === "quest"
    ? `recompensa de "${s.quest}" (${s.npc}, ato ${s.act})`
    : `vendedor ${s.npc} (ato ${s.act}, após "${s.quest}")`;
}
