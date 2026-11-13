// "Compare with my item": what the player wears (items registered from the game with Ctrl+C, else
// the imported Path of Building build) and the difference between one of them and the item being
// price checked: the totals the trade site also uses (life, resistances, attributes...), the mod lines
// and, when both items came from the game, weapon DPS and defences (PoB's raw item text has no
// armour/damage values to compute them from).
import { tr } from "../shared/i18n";
import type { ItemMod, ModKind, ParsedItem } from "./item";
import { defences, pseudoStats, weaponDps, type PseudoStat } from "./itemCalc";
import { decodePobCode, pobStages, setForStage } from "./pob";

export interface EquippedItem {
  /** PoB slot name ("Helmet", "Ring 1", "Weapon 1"...) */
  slot: string;
  item: ParsedItem;
  /** copied from the game (Ctrl+C) instead of the PoB build */
  fromGame?: boolean;
}

export interface CompareRow {
  /** "+#% total Elemental Resistance" */
  label: string;
  equipped: number;
  candidate: number;
}

export interface ItemComparison {
  slot: string;
  /** name of the equipped item */
  name: string;
  rows: CompareRow[];
  /** mod lines (not part of a total) only on the checked item / only on the equipped one */
  onlyCandidate: string[];
  onlyEquipped: string[];
  /** the equipped item was registered from the game (else: from the PoB build) */
  fromGame: boolean;
}

/** Slots an item of this class goes to (rings: every ring slot the build uses). */
export function slotsFor(itemClass: string): string[] {
  switch (itemClass) {
    case "Helmets":
      return ["Helmet"];
    case "Body Armours":
      return ["Body Armour"];
    case "Gloves":
      return ["Gloves"];
    case "Boots":
      return ["Boots"];
    case "Belts":
      return ["Belt"];
    case "Amulets":
      return ["Amulet"];
    case "Rings":
      return ["Ring 1", "Ring 2", "Ring 3"];
    case "Shields":
    case "Quivers":
      return ["Weapon 2"];
  }
  return /Sword|Axe|Mace|Bow|Claw|Dagger|Wand|Staff|Staves|Sceptre|Warstaves|Fishing Rod/i.test(itemClass) ? ["Weapon 1"] : [];
}

/** Every slot equipment can be registered to (flasks and jewels are not compared). */
export const GEAR_SLOTS = ["Weapon 1", "Weapon 2", "Helmet", "Body Armour", "Gloves", "Boots", "Belt", "Amulet", "Ring 1", "Ring 2"];

const TWO_HANDED = /Two Hand|Bows|Staves|Warstaves|Fishing Rod/i;

/**
 * Where an item copied while registering goes. `taken` = slots already filled in this registration:
 * the first ring is Ring 1 and the second Ring 2; a second one-handed weapon is the off hand.
 * null = not equipment (flask, jewel, gem, map...).
 */
export function gearSlotFor(item: ParsedItem, taken: ReadonlySet<string>): string | null {
  let slots = slotsFor(item.itemClass).filter((s) => s !== "Ring 3");
  if (slots[0] === "Weapon 1" && !TWO_HANDED.test(item.itemClass)) slots = ["Weapon 1", "Weapon 2"];
  if (!slots.length) return null;
  return slots.find((s) => !taken.has(s)) ?? slots[0];
}

const ARMOUR_SLOTS = new Set(["Helmet", "Body Armour", "Gloves", "Boots", "Weapon 2"]);

/** "+(50-60) to maximum Life" at roll 0.5 -> "+55 to maximum Life" (PoB keeps ranges with {range:x}). */
function fillRanges(line: string, roll: number): string {
  return line.replace(/\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g, (_, a: string, b: string) => {
    const lo = Number(a);
    const hi = Number(b);
    const v = lo + (hi - lo) * roll;
    return String(a.includes(".") || b.includes(".") ? Math.round(v * 100) / 100 : Math.round(v));
  });
}

/** One item of a PoB export (the text inside <Item>): rarity, names, implicits, explicits. */
export function parsePobItem(raw: string, slot: string): ParsedItem | null {
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const rarityLine = lines.findIndex((l) => /^Rarity: /i.test(l));
  if (rarityLine < 0) return null;
  const rarity = lines[rarityLine].slice(8).trim();
  const pretty = rarity.charAt(0).toUpperCase() + rarity.slice(1).toLowerCase();
  const named = pretty === "Rare" || pretty === "Unique";
  const name = lines[rarityLine + 1] ?? "";
  const baseType = named ? lines[rarityLine + 2] ?? name : name;
  const implicitsAt = lines.findIndex((l) => /^Implicits: \d+$/.test(l));
  if (implicitsAt < 0) return null;
  const implicitCount = Number(lines[implicitsAt].slice(11));
  const variant = lines.map((l) => /^Selected Variant: (\d+)$/.exec(l)).find(Boolean)?.[1] ?? null;

  const mods: ItemMod[] = [];
  lines.slice(implicitsAt + 1).forEach((line, i) => {
    if (/^(Corrupted|Mirrored|Split|Unidentified|Synthesised Item)$/.test(line)) return;
    let kind: ModKind = i < implicitCount ? "implicit" : "explicit";
    let roll = 0.5;
    let text = line;
    let skip = false;
    for (let m: RegExpExecArray | null; (m = /^\{([^}]*)\}/.exec(text)); text = text.slice(m[0].length)) {
      const [tag, value = ""] = m[1].split(":");
      if (tag === "crafted") kind = "crafted";
      else if (tag === "fractured") kind = "fractured";
      else if (tag === "enchant") kind = "enchant";
      else if (tag === "range") roll = Number(value) || 0;
      else if (tag === "variant" && variant && !value.split(",").includes(variant)) skip = true;
    }
    if (skip || !text) return;
    mods.push({ text: fillRanges(text, roll), kind });
  });

  const armour = ARMOUR_SLOTS.has(slot);
  return {
    itemClass: "",
    rarity: pretty,
    name: named ? name : "",
    baseType,
    stackSize: null,
    itemLevel: null,
    gemLevel: null,
    quality: 0,
    mapTier: null,
    sockets: "",
    links: 0,
    corrupted: lines.includes("Corrupted"),
    mirrored: false,
    unidentified: false,
    influences: [],
    mods,
    affixes: null,
    // only tells pseudoStats that flat ES is part of the armour value here
    props: { phys: null, ele: [], chaos: null, aps: null, crit: null, armour: null, evasion: null, es: armour ? 0 : null, ward: null },
  };
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");

/** What the build wears: the active item set's slots (or the old top-level <Slot> list). */
export function parsePobEquipped(xml: string, stage?: number): EquippedItem[] {
  const block = /<Items\b([^>]*)>([\s\S]*?)<\/Items>/.exec(xml);
  if (!block) return [];
  const items = new Map<string, string>();
  for (const m of block[2].matchAll(/<Item\b([^>]*)>([\s\S]*?)<\/Item>/g)) {
    const id = /\bid="(\d+)"/.exec(m[1])?.[1];
    if (id) items.set(id, unescapeXml(m[2].replace(/<ModRange[^>]*\/>/g, "")));
  }
  const activeSet = /\bactiveItemSet="(\d+)"/.exec(block[1])?.[1];
  const sets = [...block[2].matchAll(/<ItemSet\b([^>]*)>([\s\S]*?)<\/ItemSet>/g)].map((m) => ({
    id: /\bid="(\d+)"/.exec(m[1])?.[1],
    title: unescapeXml(/\btitle="([^"]*)"/.exec(m[1])?.[1] ?? ""),
    body: m[2],
  }));
  const active = sets.find((s) => s.id === activeSet);
  const stages = pobStages(xml);
  const spec = stage !== undefined && stage >= 0 && stage < stages.titles.length ? stage : null;
  const set = (spec === null ? active : setForStage(sets, spec, stages.titles[spec], active)) ?? sets[0];
  const slotsXml = set ? set.body : block[2];
  const out: EquippedItem[] = [];
  for (const s of slotsXml.matchAll(/<Slot\b([^>]*?)\/?>/g)) {
    const name = /\bname="([^"]*)"/.exec(s[1])?.[1];
    const itemId = /\bitemId="(\d+)"/.exec(s[1])?.[1];
    if (!name || !itemId || itemId === "0" || /Swap|Flask|Jewel|Abyssal|Graft/.test(name)) continue;
    const raw = items.get(itemId);
    const item = raw ? parsePobItem(raw, name) : null;
    if (item && !out.some((o) => o.slot === name)) out.push({ slot: name, item });
  }
  return out;
}

export function importPobEquipped(code: string, stage?: number): EquippedItem[] {
  return parsePobEquipped(decodePobCode(code), stage);
}

/** "+68% total Elemental Resistance" -> "+#% total Elemental Resistance" (the sign stays). */
const label = (text: string) => text.replace(/\d+(?:\.\d+)?/, "#");
/** Mod lines compared as text: numbers become # so "+40 to Strength" matches "+25 to Strength". */
const modKey = (text: string) => text.replace(/\d+(?:\.\d+)?/g, "#");

/** The checked item against what the build wears in the same slot(s). */
/** Weapon DPS and defences, when both items have them (items copied from the game do, PoB's do not). */
function calcRows(candidate: ParsedItem, equipped: ParsedItem): CompareRow[] {
  const rows: CompareRow[] = [];
  const add = (label: string, c: number | null | undefined, e: number | null | undefined) => {
    if (c != null && e != null && (c || e)) rows.push({ label, candidate: c, equipped: e });
  };
  const cw = weaponDps(candidate);
  const ew = weaponDps(equipped);
  if (cw && ew) {
    add(tr("DPS físico (Q20)", "Physical DPS (Q20)"), cw.pdpsQ20, ew.pdpsQ20);
    add(tr("DPS elemental", "Elemental DPS"), cw.edps, ew.edps);
    add(tr("DPS total (Q20)", "Total DPS (Q20)"), cw.dpsQ20, ew.dpsQ20);
  }
  const cd = defences(candidate);
  const ed = defences(equipped);
  if (cd && ed) {
    add(tr("Armadura (Q20)", "Armour (Q20)"), cd.armourQ20 ?? 0, ed.armourQ20 ?? 0);
    add(tr("Evasão (Q20)", "Evasion (Q20)"), cd.evasionQ20 ?? 0, ed.evasionQ20 ?? 0);
    add(tr("Energy Shield (Q20)", "Energy Shield (Q20)"), cd.esQ20 ?? 0, ed.esQ20 ?? 0);
  }
  return rows;
}

const RES = "pseudo.pseudo_total_resistance";
const ELE_RES = "pseudo.pseudo_total_elemental_resistance";
const ATTRS = ["pseudo.pseudo_total_strength", "pseudo.pseudo_total_dexterity", "pseudo.pseudo_total_intelligence"];

/**
 * The totals, side by side. "Total resistance" (elemental + chaos, a trade filter that only exists when
 * an item has chaos res) reads as chaos resistance alone; the three attributes are one "all
 * attributes" row when each side has the same value for all three.
 */
function totalRows(cPseudo: PseudoStat[], ePseudo: PseudoStat[]): CompareRow[] {
  const val = (list: PseudoStat[], id: string) => list.find((p) => p.statId === id)?.value ?? 0;
  const chaos = (list: PseudoStat[]) => (list.some((p) => p.statId === RES) ? val(list, RES) - val(list, ELE_RES) : 0);
  const sameAttrs = (list: PseudoStat[]) => ATTRS.every((id) => val(list, id) === val(list, ATTRS[0]));
  const allAttrs = sameAttrs(cPseudo) && sameAttrs(ePseudo);
  const ids = [...new Set([...cPseudo.map((p) => p.statId), ...ePseudo.map((p) => p.statId)])];
  const rows: CompareRow[] = [];
  for (const id of ids) {
    if (id === RES) {
      rows.push({ label: "+#% to Chaos Resistance", equipped: chaos(ePseudo), candidate: chaos(cPseudo) });
    } else if (ATTRS.includes(id) && allAttrs) {
      if (id === ATTRS[0]) rows.push({ label: "+# total to all Attributes", equipped: val(ePseudo, id), candidate: val(cPseudo, id) });
    } else {
      const c = cPseudo.find((p) => p.statId === id);
      const e = ePseudo.find((p) => p.statId === id);
      rows.push({ label: label((c ?? e)!.text), equipped: e?.value ?? 0, candidate: c?.value ?? 0 });
    }
  }
  return rows;
}

export function compareItem(candidate: ParsedItem, equipped: readonly EquippedItem[]): ItemComparison[] {
  const slots = slotsFor(candidate.itemClass);
  const cPseudo = pseudoStats(candidate);
  const cFolded = new Set(cPseudo.flatMap((p) => p.from));
  const out: ItemComparison[] = [];
  for (const slot of slots) {
    const eq = equipped.find((e) => e.slot === slot);
    if (!eq) continue;
    const ePseudo = pseudoStats(eq.item);
    const eFolded = new Set(ePseudo.flatMap((p) => p.from));
    const rows = totalRows(cPseudo, ePseudo);
    const cLines = candidate.mods.filter((m) => m.kind !== "enchant" && !cFolded.has(m.text)).map((m) => m.text);
    const eLines = eq.item.mods.filter((m) => m.kind !== "enchant" && !eFolded.has(m.text)).map((m) => m.text);
    rows.push(...calcRows(candidate, eq.item));
    const cKeys = new Set(cLines.map(modKey));
    const eKeys = new Set(eLines.map(modKey));
    out.push({
      slot,
      name: eq.item.name || eq.item.baseType,
      rows: rows.filter((r) => r.equipped !== r.candidate || r.candidate !== 0),
      onlyCandidate: cLines.filter((l) => !eKeys.has(modKey(l))),
      onlyEquipped: eLines.filter((l) => !cKeys.has(modKey(l))),
      fromGame: !!eq.fromGame,
    });
  }
  return out;
}
