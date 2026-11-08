// Parser for the item text the game puts on the clipboard (Ctrl+C or Ctrl+Alt+C over an item).
// Pure logic; the format is the PoE1 one with the "Item Class:" header.

export type ModKind = "explicit" | "implicit" | "crafted" | "fractured" | "enchant" | "scourge" | "crucible";

export interface ItemMod {
  text: string;
  kind: ModKind;
  // only with Ctrl+Alt+C (advanced copy), from the "{ Prefix Modifier ... (Tier: 3) }" header:
  affix?: "prefix" | "suffix";
  /** 1 = best tier */
  tier?: number;
  /** crafted mods have ranks instead of tiers */
  rank?: number;
  modName?: string;
  /** where the roll landed in its range: 0 = minimum, 1 = maximum (first number of the line) */
  roll?: number;
}

export interface ParsedItem {
  itemClass: string;
  rarity: string; // Normal, Magic, Rare, Unique, Gem, Currency, Divination Card, ...
  /** unique / rare name, or the item name for currency, gems and cards */
  name: string;
  /** base type for unique / rare / normal items; same as name for currency, gems, cards */
  baseType: string;
  stackSize: number | null;
  itemLevel: number | null;
  gemLevel: number | null;
  quality: number;
  mapTier: number | null;
  sockets: string;
  links: number;
  corrupted: boolean;
  mirrored: boolean;
  unidentified: boolean;
  influences: string[];
  mods: ItemMod[];
  /** prefix / suffix counts when the advanced copy (Ctrl+Alt+C) shows them; null otherwise */
  affixes: { prefix: number; suffix: number; maxPrefix: number; maxSuffix: number } | null;
}

const SEP = /^-{8}$/;
const SUFFIX_KIND: [RegExp, ModKind][] = [
  [/ \(implicit\)$/, "implicit"],
  [/ \(crafted\)$/, "crafted"],
  [/ \(fractured\)$/, "fractured"],
  [/ \(enchant\)$/, "enchant"],
  [/ \(scourge\)$/, "scourge"],
  [/ \(crucible\)$/, "crucible"],
];
const INFLUENCES = [
  "Shaper",
  "Elder",
  "Crusader",
  "Hunter",
  "Redeemer",
  "Warlord",
  "Searing Exarch",
  "Eater of Worlds",
];
const NON_MOD_LINES = new Set([
  "Corrupted",
  "Mirrored",
  "Unidentified",
  "Split",
  "Synthesised Item",
  "Fractured Item",
  "Unmodifiable",
  ...INFLUENCES.map((i) => `${i} Item`),
]);

const num = (s: string): number => Number(s.replace(/[,.\s](?=\d{3}\b)/g, ""));

/** Text that looks like an item copied from the game. */
export function looksLikeItem(text: string): boolean {
  return /^Item Class: .+\r?\nRarity: .+/.test(text);
}

function socketLinks(sockets: string): number {
  let best = 0;
  for (const group of sockets.trim().split(/\s+/)) {
    const n = group.split("-").filter(Boolean).length;
    best = Math.max(best, n);
  }
  return best;
}

function stripBase(base: string): string {
  return base.replace(/^(Superior|Synthesised) /, "");
}

export function parseItem(text: string): ParsedItem | null {
  if (!looksLikeItem(text)) return null;
  const lines = text.replace(/\r/g, "").split("\n");
  const sections: string[][] = [[]];
  for (const raw of lines) {
    const l = raw.trim();
    if (SEP.test(l)) sections.push([]);
    else if (l) sections[sections.length - 1].push(l);
  }

  const head = sections[0];
  const itemClass = head[0].slice("Item Class: ".length).trim();
  const rarity = head[1].slice("Rarity: ".length).trim();
  const names = head.slice(2);
  let name = names[0] ?? "";
  let baseType = names[1] ?? names[0] ?? "";

  const item: ParsedItem = {
    itemClass,
    rarity,
    name,
    baseType,
    stackSize: null,
    itemLevel: null,
    gemLevel: null,
    quality: 0,
    mapTier: null,
    sockets: "",
    links: 0,
    corrupted: false,
    mirrored: false,
    unidentified: false,
    influences: [],
    mods: [],
    affixes: null,
  };

  let ilvlSection = -1;
  sections.forEach((sec, si) => {
    for (const l of sec) {
      let m: RegExpExecArray | null;
      if ((m = /^Stack Size: ([\d,.\s]+)\//.exec(l))) item.stackSize = num(m[1]);
      else if ((m = /^Item Level: (\d+)/.exec(l))) {
        item.itemLevel = Number(m[1]);
        ilvlSection = si;
      } else if ((m = /^Level: (\d+)/.exec(l)) && /Gem/.test(rarity) && si === 1) item.gemLevel = Number(m[1]);
      else if ((m = /^Quality(?: \([^)]*\))?: \+(\d+)%/.exec(l))) item.quality = Number(m[1]);
      else if ((m = /^Map Tier: (\d+)/.exec(l))) item.mapTier = Number(m[1]);
      else if ((m = /^Sockets: (.+)$/.exec(l))) {
        item.sockets = m[1].trim();
        item.links = socketLinks(item.sockets);
      } else if (l === "Corrupted") item.corrupted = true;
      else if (l === "Mirrored") item.mirrored = true;
      else if (l === "Unidentified") item.unidentified = true;
      else if (l.endsWith(" Item") && INFLUENCES.includes(l.slice(0, -5))) item.influences.push(l.slice(0, -5));
    }
  });

  // Mods live in the sections after "Item Level"; anything else there (flavour text, notes) is
  // kept too and later dropped when it does not match a known trade stat.
  let header: ModHeader | null = null;
  let prefixes = 0;
  let suffixes = 0;
  let sawHeaders = false;
  if (ilvlSection >= 0) {
    for (const sec of sections.slice(ilvlSection + 1)) {
      header = null; // a header only covers lines of its own section
      for (let l of sec) {
        if (l.startsWith("{")) {
          header = parseModHeader(l);
          sawHeaders = true;
          if (header.affix === "prefix") prefixes++;
          if (header.affix === "suffix") suffixes++;
          continue;
        }
        if (NON_MOD_LINES.has(l) || l.startsWith("Note:")) continue;
        if (/^(Requires|Requirements:|Level:|Str:|Dex:|Int:)/.test(l)) continue;
        let kind: ModKind = "explicit";
        for (const [re, k] of SUFFIX_KIND) {
          if (re.test(l)) {
            kind = k;
            l = l.replace(re, "");
            break;
          }
        }
        // Ctrl+Alt+C adds roll ranges: "+38(30-39) to maximum Life"
        const roll = rollOf(l);
        l = l.replace(/(\d)\((-?[\d.]+)-(-?[\d.]+)\)/g, "$1").replace(/ — Unscalable Value$/, "");
        const mod: ItemMod = { text: l, kind };
        if (header) {
          if (header.affix) mod.affix = header.affix;
          if (header.tier !== undefined) mod.tier = header.tier;
          if (header.rank !== undefined) mod.rank = header.rank;
          if (header.name) mod.modName = header.name;
        }
        if (roll !== null) mod.roll = roll;
        item.mods.push(mod);
      }
    }
  }

  if (rarity === "Unique" || rarity === "Rare") {
    if (names.length < 2) {
      // unidentified: only the base is shown
      name = "";
      baseType = names[0] ?? "";
    }
  } else if (rarity === "Normal" || rarity === "Magic") {
    name = names[0] ?? "";
    baseType = names[0] ?? "";
  } else {
    baseType = name;
  }
  item.name = name;
  item.baseType = stripBase(baseType);
  if (/Gem/.test(rarity) && item.gemLevel === null) item.gemLevel = 1;
  if (sawHeaders && (rarity === "Rare" || rarity === "Magic")) {
    // jewels have 2 + 2 affixes, magic items 1 + 1, other rares 3 + 3
    const max = rarity === "Magic" ? 1 : /Jewel/.test(itemClass) ? 2 : 3;
    item.affixes = { prefix: prefixes, suffix: suffixes, maxPrefix: max, maxSuffix: max };
  }
  return item;
}

interface ModHeader {
  affix?: "prefix" | "suffix";
  tier?: number;
  rank?: number;
  name?: string;
}

/** `{ Master Crafted Suffix Modifier "Upgraded" (Rank: 2) — Life }` -> { affix, rank, name } */
export function parseModHeader(line: string): ModHeader {
  const h: ModHeader = {};
  const body = line.replace(/^\{\s*/, "").replace(/\s*\}$/, "").split(" — ")[0];
  if (/\bPrefix Modifier\b/.test(body)) h.affix = "prefix";
  else if (/\bSuffix Modifier\b/.test(body)) h.affix = "suffix";
  const tier = /\(Tier: (\d+)\)/.exec(body);
  if (tier) h.tier = Number(tier[1]);
  const rank = /\(Rank: (\d+)\)/.exec(body);
  if (rank) h.rank = Number(rank[1]);
  const name = /"([^"]+)"/.exec(body);
  if (name) h.name = name[1];
  return h;
}

/** "+38(30-39) to maximum Life" -> 0.89 (where 38 sits between 30 and 39); null without a range. */
export function rollOf(line: string): number | null {
  const m = /(-?[\d.]+)\((-?[\d.]+)-(-?[\d.]+)\)/.exec(line);
  if (!m) return null;
  const [v, a, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (![v, a, b].every(Number.isFinite)) return null;
  if (b === a) return 1;
  return Math.max(0, Math.min(1, (v - a) / (b - a)));
}
