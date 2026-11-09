// "Compare with my item": the items of the imported Path of Building build (what the player wears)
// and the difference between one of them and the item being price checked. Only the totals the
// trade site also uses (life, resistances, attributes...) and the mod lines themselves are compared:
// PoB's raw item text has no armour/damage values to compute DPS or defences from.
import type { ItemMod, ModKind, ParsedItem } from "./item";
import { pseudoStats } from "./itemCalc";
import { decodePobCode } from "./pob";

export interface EquippedItem {
  /** PoB slot name ("Helmet", "Ring 1", "Weapon 1"...) */
  slot: string;
  item: ParsedItem;
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
export function parsePobEquipped(xml: string): EquippedItem[] {
  const block = /<Items\b([^>]*)>([\s\S]*?)<\/Items>/.exec(xml);
  if (!block) return [];
  const items = new Map<string, string>();
  for (const m of block[2].matchAll(/<Item\b([^>]*)>([\s\S]*?)<\/Item>/g)) {
    const id = /\bid="(\d+)"/.exec(m[1])?.[1];
    if (id) items.set(id, unescapeXml(m[2].replace(/<ModRange[^>]*\/>/g, "")));
  }
  const activeSet = /\bactiveItemSet="(\d+)"/.exec(block[1])?.[1];
  const sets = [...block[2].matchAll(/<ItemSet\b([^>]*)>([\s\S]*?)<\/ItemSet>/g)];
  const set = sets.find((s) => /\bid="(\d+)"/.exec(s[1])?.[1] === activeSet) ?? sets[0];
  const slotsXml = set ? set[2] : block[2];
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

export function importPobEquipped(code: string): EquippedItem[] {
  return parsePobEquipped(decodePobCode(code));
}

const label = (text: string) => text.replace(/[+-]?\d+(?:\.\d+)?/, "#");
/** Mod lines compared as text: numbers become # so "+40 to Strength" matches "+25 to Strength". */
const modKey = (text: string) => text.replace(/\d+(?:\.\d+)?/g, "#");

/** The checked item against what the build wears in the same slot(s). */
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
    const ids = [...new Set([...cPseudo.map((p) => p.statId), ...ePseudo.map((p) => p.statId)])];
    const rows = ids.map((id) => {
      const c = cPseudo.find((p) => p.statId === id);
      const e = ePseudo.find((p) => p.statId === id);
      return { label: label((c ?? e)!.text), equipped: e?.value ?? 0, candidate: c?.value ?? 0 };
    });
    const cLines = candidate.mods.filter((m) => m.kind !== "enchant" && !cFolded.has(m.text)).map((m) => m.text);
    const eLines = eq.item.mods.filter((m) => m.kind !== "enchant" && !eFolded.has(m.text)).map((m) => m.text);
    const cKeys = new Set(cLines.map(modKey));
    const eKeys = new Set(eLines.map(modKey));
    out.push({
      slot,
      name: eq.item.name || eq.item.baseType,
      rows: rows.filter((r) => r.equipped !== r.candidate || r.candidate !== 0),
      onlyCandidate: cLines.filter((l) => !eKeys.has(modKey(l))),
      onlyEquipped: eLines.filter((l) => !cKeys.has(modKey(l))),
    });
  }
  return out;
}
