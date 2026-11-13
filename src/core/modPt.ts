// Item mod lines in Portuguese, from GGG's own translation: the Brazilian trade site's stat list
// (br.pathofexile.com/api/trade/data/stats) has the same stat ids as the English one, so an English
// line -> its English template -> stat id -> the Portuguese template, with the line's numbers put back.
// Buff / charge / ailment names stay in English (the owner plays the English client).
import { template, type TradeStatsData } from "./stats";

/** Portuguese game terms that stay in English, longest first (GGG's pt -> the English name). */
const KEEP: [string, string][] = [
  ["Cargas de Frenesi", "Frenzy Charges"], ["Carga de Frenesi", "Frenzy Charge"],
  ["Cargas de Poder", "Power Charges"], ["Carga de Poder", "Power Charge"],
  ["Cargas de Tolerância", "Endurance Charges"], ["Carga de Tolerância", "Endurance Charge"],
  ["Golpe de Misericórdia", "Culling Strike"], ["Vento Favorável", "Tailwind"],
  ["Poder Profano", "Unholy Might"], ["Fúria Arcana", "Arcane Surge"],
  ["Agressividade", "Onslaught"], ["Elusivo", "Elusive"], ["Trespassando", "Phasing"], ["Trespassar", "Phasing"],
  ["Fortificação", "Fortification"], ["Fortificar", "Fortify"], ["Adrenalina", "Adrenaline"],
  ["Eletrizados", "Shocked"], ["Eletrizado", "Shocked"], ["Incendiados", "Ignited"], ["Incendiado", "Ignited"],
  ["Congelados", "Frozen"], ["Congelado", "Frozen"], ["Resfriados", "Chilled"], ["Resfriado", "Chilled"],
  ["Fragilidade", "Brittle"], ["Definhamento", "Withered"], ["Definhados", "Withered"],
  ["Empalamento", "Impale"], ["Empalar", "Impale"],
];
const KEEP_RE = KEEP.map(([pt, en]) => [new RegExp(`(?<![\\p{L}])${pt}(?![\\p{L}])`, "gu"), en] as const);

const NUM = /[+-]?\d+(?:\.\d+)?/g;
const local = (t: string) => t.replace(/ \(Local\)$/, "");

export class ModTranslator {
  /** English template -> Portuguese template */
  private map = new Map<string, string>();

  constructor(en: TradeStatsData, pt: TradeStatsData) {
    const ptById = new Map<string, string>();
    for (const g of pt.result) for (const e of g.entries) if (!e.option) ptById.set(e.id, local(e.text));
    for (const g of en.result) {
      for (const e of g.entries) {
        const p = ptById.get(e.id);
        const k = local(e.text);
        if (!p || e.option) continue;
        if (!this.map.has(k)) this.map.set(k, p);
        // numbers written in the stat text ("for 4 seconds") are numbers in the copied line too
        const general = template(k).key;
        if (general !== k && !this.map.has(general)) this.map.set(general, template(p).key);
      }
    }
  }

  get size(): number {
    return this.map.size;
  }

  /** The line in Portuguese, or unchanged when GGG's list has no match for it. */
  translate(line: string): string {
    const { key } = template(line);
    const nums = line.match(NUM) ?? [];
    for (const k of [key, key.replace(/^\+#/, "#"), key.replace(/^#/, "+#")]) {
      const pt = this.map.get(k);
      if (pt === undefined) continue;
      const slots = pt.match(/[+-]?#/g) ?? [];
      if (slots.length !== nums.length) continue;
      let i = 0;
      const out = pt.replace(/[+-]?#/g, (slot) => {
        const n = nums[i++];
        const bare = n.replace(/^\+/, "");
        return slot === "#" ? bare : /^[+-]/.test(n) ? n : `+${n}`;
      });
      return keep(out);
    }
    return line;
  }
}

function keep(s: string): string {
  for (const [re, en] of KEEP_RE) s = s.replace(re, en);
  return s;
}
