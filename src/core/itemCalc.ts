// Numbers the trade site searches by but the item text does not spell out: pseudo totals (all
// resistance lines summed, life with strength...), weapon DPS and armour values at 20% quality.
import type { ItemMod, ParsedItem } from "./item";

export interface PseudoStat {
  /** trade stat id ("pseudo.pseudo_total_life") */
  statId: string;
  /** shown like the trade site ("+87% total Elemental Resistance") */
  text: string;
  value: number;
  /** mod lines folded into it (their own filters get switched off) */
  from: string[];
}

const first = (s: string): number | null => {
  const m = /([+-]?\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) : null;
};

/** Mods that count for totals: explicit, implicit, crafted, fractured (not enchants on armour? they count too). */
const counts = (m: ItemMod) => m.kind !== "scourge";

/**
 * Totals the trade site keeps as pseudo stats. Only lines that add to a total are folded: the
 * individual mods stay on the list but are switched off when their total is used.
 */
export function pseudoStats(item: ParsedItem): PseudoStat[] {
  const res = { fire: 0, cold: 0, lightning: 0, chaos: 0 };
  const attr = { str: 0, dex: 0, int: 0 };
  let life = 0;
  let mana = 0;
  let es = 0;
  let move = 0;
  const from: Record<string, string[]> = {};
  const note = (key: string, line: string) => (from[key] ??= []).push(line);
  // flat ES on armour is part of its Energy Shield property, not a pseudo total
  const armourPiece = item.props.armour !== null || item.props.evasion !== null || item.props.es !== null;

  for (const m of item.mods.filter(counts)) {
    const t = m.text;
    const v = first(t);
    if (v === null) continue;
    let r: RegExpExecArray | null;
    if ((r = /^\+\d+% to all Elemental Resistances$/.exec(t))) {
      res.fire += v;
      res.cold += v;
      res.lightning += v;
      note("res", t);
    } else if ((r = /^\+\d+% to (.+) Resistances?$/.exec(t))) {
      const parts = r[1].split(/ and /i).map((p) => p.trim().toLowerCase());
      let any = false;
      for (const p of parts) {
        if (p === "fire" || p === "cold" || p === "lightning" || p === "chaos") {
          res[p] += v;
          any = true;
        }
      }
      if (any) note("res", t);
    } else if (/^\+\d+ to maximum Life$/.test(t)) {
      life += v;
      note("life", t);
    } else if (/^\+\d+ to maximum Mana$/.test(t)) {
      mana += v;
      note("mana", t);
    } else if (/^\+\d+ to maximum Energy Shield$/.test(t) && !armourPiece) {
      es += v;
      note("es", t);
    } else if ((r = /^\+\d+ to (Strength|Dexterity|Intelligence|all Attributes)(?: and (Strength|Dexterity|Intelligence))?$/.exec(t))) {
      const add = (a: string) => {
        if (a === "Strength") attr.str += v;
        else if (a === "Dexterity") attr.dex += v;
        else if (a === "Intelligence") attr.int += v;
        else {
          attr.str += v;
          attr.dex += v;
          attr.int += v;
        }
      };
      add(r[1]);
      if (r[2]) add(r[2]);
      note("attr", t);
    } else if (/^\d+% increased Movement Speed$/.test(t)) {
      move += v;
      note("move", t);
    }
  }

  const out: PseudoStat[] = [];
  const ele = res.fire + res.cold + res.lightning;
  if (ele > 0) out.push({ statId: "pseudo.pseudo_total_elemental_resistance", text: `+${ele}% total Elemental Resistance`, value: ele, from: from.res ?? [] });
  if (res.chaos > 0 && ele > 0) {
    out.push({ statId: "pseudo.pseudo_total_resistance", text: `+${ele + res.chaos}% total Resistance`, value: ele + res.chaos, from: from.res ?? [] });
  }
  // the trade site counts half of the strength as life
  const totalLife = life + Math.floor(attr.str / 2);
  if (life > 0) out.push({ statId: "pseudo.pseudo_total_life", text: `+${totalLife} total maximum Life`, value: totalLife, from: from.life ?? [] });
  if (es > 0) out.push({ statId: "pseudo.pseudo_total_energy_shield", text: `+${es} total maximum Energy Shield`, value: es, from: from.es ?? [] });
  if (mana > 0) out.push({ statId: "pseudo.pseudo_total_mana", text: `+${mana} total maximum Mana`, value: mana, from: from.mana ?? [] });
  const attrs = (["str", "dex", "int"] as const).filter((k) => attr[k] > 0);
  const label = { str: "Strength", dex: "Dexterity", int: "Intelligence" };
  if (attrs.length) {
    for (const k of attrs) {
      out.push({ statId: `pseudo.pseudo_total_${label[k].toLowerCase()}`, text: `+${attr[k]} total to ${label[k]}`, value: attr[k], from: from.attr ?? [] });
    }
  }
  if (move > 0) out.push({ statId: "pseudo.pseudo_increased_movement_speed", text: `${move}% increased Movement Speed`, value: move, from: from.move ?? [] });
  return out;
}

const avg = (r: [number, number] | null) => (r ? (r[0] + r[1]) / 2 : 0);

/** Sum of a local "#% increased X" on the item (weapons/armour scale their own base with it). */
function localIncreased(item: ParsedItem, re: RegExp): number {
  return item.mods.reduce((s, m) => {
    const r = re.exec(m.text);
    return r ? s + Number(r[1]) : s;
  }, 0);
}

export interface WeaponDps {
  pdps: number;
  edps: number;
  cdps: number;
  dps: number;
  /** the same at 20% quality (only physical damage scales with quality) */
  pdpsQ20: number;
  dpsQ20: number;
}

export function weaponDps(item: ParsedItem): WeaponDps | null {
  const p = item.props;
  if (!p.aps || (!p.phys && !p.ele.length && !p.chaos)) return null;
  const pdps = avg(p.phys) * p.aps;
  const edps = p.ele.reduce((s, r) => s + avg(r), 0) * p.aps;
  const cdps = avg(p.chaos) * p.aps;
  const inc = localIncreased(item, /^(\d+)% increased Physical Damage$/);
  const q = item.quality;
  const pdpsQ20 = q < 20 ? (pdps * (100 + inc + 20)) / (100 + inc + q) : pdps;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { pdps: r1(pdps), edps: r1(edps), cdps: r1(cdps), dps: r1(pdps + edps + cdps), pdpsQ20: r1(pdpsQ20), dpsQ20: r1(pdpsQ20 + edps + cdps) };
}

export interface Defences {
  armour: number | null;
  evasion: number | null;
  es: number | null;
  ward: number | null;
  /** at 20% quality */
  armourQ20: number | null;
  evasionQ20: number | null;
  esQ20: number | null;
}

export function defences(item: ParsedItem): Defences | null {
  const p = item.props;
  if (p.armour === null && p.evasion === null && p.es === null && p.ward === null) return null;
  const q = item.quality;
  // local "increased" mods, hybrids included ("increased Armour and Evasion")
  const incOf = (word: string) =>
    item.mods.reduce((s, m) => {
      const r = /^(\d+)% increased (.+)$/.exec(m.text);
      if (!r) return s;
      const what = r[2];
      if (/Rating$|Shield$|Armour$|Evasion$/.test(what) && what.split(/,? and |, /).some((w) => w.startsWith(word))) return s + Number(r[1]);
      return s;
    }, 0);
  const q20 = (v: number | null, inc: number) => (v === null ? null : q < 20 ? Math.round((v * (100 + inc + 20)) / (100 + inc + q)) : v);
  return {
    armour: p.armour,
    evasion: p.evasion,
    es: p.es,
    ward: p.ward,
    armourQ20: q20(p.armour, incOf("Armour")),
    evasionQ20: q20(p.evasion, incOf("Evasion")),
    esQ20: q20(p.es, incOf("Energy Shield")),
  };
}
