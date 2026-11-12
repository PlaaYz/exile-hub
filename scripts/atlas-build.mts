// Builds the site's Atlas tree files from GGG's official export (github.com/grindinggear/atlastree-export).
// Portuguese texts: GGG's own translation first (the English and Brazilian atlas tree pages, paired node
// by node), then data/atlas-ptbr.json (the owner's table: texts the official tree lacks or has not
// translated yet; English with numbers as "#" -> Portuguese).
// Usage: npx vite-node scripts/atlas-build.mts <tag e.g. 3.30.0>
// Writes docs/atlas/{data,ruthless}.json and img/, and prints the texts left in English: add them to the table.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { orbitAngle } from "../src/core/passives";

interface RawNode {
  skill?: number;
  name?: string;
  stats?: string[];
  reminderText?: string[];
  flavourText?: string[];
  group?: number;
  orbit?: number;
  orbitIndex?: number;
  out?: string[];
  in?: string[];
  isNotable?: boolean;
  isKeystone?: boolean;
  isMastery?: boolean;
  isWormhole?: boolean;
  variantEffects?: { effect: number; stats: string[] }[];
  icon?: string;
}
type Sheet = { filename: string; coords: Record<string, { x: number; y: number; w: number; h: number }> };
interface Raw {
  nodes: Record<string, RawNode>;
  groups: Record<string, { x: number; y: number; background?: { image: string; offsetX?: number; offsetY?: number } }>;
  sprites: Record<string, Record<string, Sheet>>;
  constants: { skillsPerOrbit: number[]; orbitRadii: number[] };
  points: { totalPoints: number };
}

const [tag] = process.argv.slice(2);
if (!tag) throw new Error("usage: atlas-build.mts <tag>");

const PTBR = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../data/atlas-ptbr.json"), "utf8")) as Record<string, string>;
// the same table with every key on one line: GGG wraps long sentences at other places than the table does
const FLAT = new Map(Object.entries(PTBR).map(([k, v]) => [k.replace(/\s+/g, " "), v]));

const NUM = /\d+(?:\.\d+)?/g;
const missing = new Set<string>();

/** GGG's markup "[Thread|Threads]" / "[Mirage]" -> the text the game shows ("Threads", "Mirage"). */
const plain = (text: string) => text.replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$2").replace(/\[([^\]]+)\]/g, "$1");
const flatKey = (text: string) => plain(text).replace(/\s+/g, " ").trim().replace(NUM, "#");

/**
 * GGG's own translation: the atlas tree pages of pathofexile.com and br.pathofexile.com carry the tree
 * data; the same node's texts in both languages make an English -> Portuguese template (numbers as
 * "#"; only when both have the same count of numbers). These pages may still show the previous patch.
 */
async function officialTable(): Promise<Map<string, string>> {
  const tree = async (host: string) => {
    const res = await fetch(`https://${host}/atlas-skill-tree`, { headers: { "User-Agent": "ExileHub atlas build (contact: exilehub.contato@gmail.com)" } });
    if (!res.ok) throw new Error(`${host} HTTP ${res.status}`);
    const html = await res.text();
    // the object after "passiveSkillTreeData", read as data (brace matching, strings respected)
    const start = html.indexOf("{", html.indexOf("passiveSkillTreeData"));
    let depth = 0;
    let quoted = false;
    let end = start;
    for (; end < html.length; end++) {
      const c = html[end];
      if (quoted) {
        if (c === "\\") end++;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    return JSON.parse(html.slice(start, end + 1)) as { nodes: Record<string, RawNode> };
  };
  const [en, pt] = await Promise.all([tree("www.pathofexile.com"), tree("br.pathofexile.com")]);
  const table = new Map<string, string>();
  const pair = (a: string[] | undefined, b: string[] | undefined) => {
    if (!a || !b || a.length !== b.length) return;
    a.forEach((text, i) => {
      const nums = (plain(text).match(NUM) ?? []).length;
      const t = plain(b[i]).replace(/[ 	]+/g, " ").trim();
      if ((t.match(NUM) ?? []).length === nums && t !== plain(text).trim()) table.set(flatKey(text), t.replace(NUM, "#"));
    });
  };
  for (const [id, n] of Object.entries(en.nodes)) {
    const m = pt.nodes[id];
    if (!m) continue;
    pair(n.stats, m.stats);
    pair(n.reminderText, m.reminderText);
    pair(n.flavourText, m.flavourText);
    n.variantEffects?.forEach((v, i) => pair(v.stats, m.variantEffects?.[i]?.stats));
  }
  return table;
}
const OFFICIAL = await officialTable();
console.log(`${OFFICIAL.size} official translations`);

function lookup(line: string): string | undefined {
  const key = line.replace(NUM, "#");
  const p = OFFICIAL.get(key.replace(/\s+/g, " ").trim()) ?? PTBR[key] ?? FLAT.get(key.replace(/\s+/g, " "));
  if (p === undefined) return undefined;
  const nums = line.match(NUM) ?? [];
  let i = 0;
  return keepKeywords(p.replace(/#/g, () => nums[i++] ?? "#"));
}

// Mechanic keywords stay as in the English client (owner, 2026-11-12: "Thread" is what players search
// and talk about, "Fios" is not). Longer phrases first: "Altares Ritualísticos" before "Altar".
const KEEP: [string, string][] = [
  ["Fios de Memória", "Memory Strands"], ["Vestígios de Memória", "Memory Traces"], ["Fios", "Threads"], ["Fio", "Thread"],
  ["Altares Ritualísticos", "Ritual Altars"], ["Altar Ritualístico", "Ritual Altar"], ["Altares", "Shrines"], ["Altar", "Shrine"],
  ["Cofres", "Strongboxes"], ["Cofre", "Strongbox"],
  ["Mercenários", "Mercenaries"], ["Mercenário", "Mercenary"],
  ["Joias Abissais", "Abyss Jewels"], ["Abismos", "Abysses"], ["Abismo", "Abyss"],
  ["Fendas Instáveis", "Unstable Breaches"], ["Fenda Instável", "Unstable Breach"], ["Fendas", "Breaches"], ["Fenda", "Breach"],
  ["Exilados Renegados", "Rogue Exiles"], ["Exilado Renegado", "Rogue Exile"],
  ["Bestas Vermelhas", "Red Beasts"], ["Besta Vermelha", "Red Beast"], ["Bestas Amarelas", "Yellow Beasts"], ["Besta Amarela", "Yellow Beast"],
  ["Bestas", "Beasts"], ["Besta", "Beast"],
  ["Espelho do Delírio", "Mirror of Delirium"], ["Miragens", "Mirages"], ["Miragem", "Mirage"], ["Bosque Viridiano", "Viridian Wildwood"],
  ["Sentinelas Enterradas", "Buried Sentinels"], ["Sentinela Enterrada", "Buried Sentinel"],
  ["Evocadores Demoníacos", "Demonic Evocators"], ["Evocador Demoníaco", "Demonic Evocator"],
  ["Monstros Aprisionados", "Imprisoned Monsters"], ["Monstro Aprisionado", "Imprisoned Monster"],
  ["Floras Sagradas", "Sacred Flora"], ["Flora Sagrada", "Sacred Flora"], ["Fauna Sagrada", "Sacred Fauna"],
  ["Expedições", "Expeditions"], ["Expedição", "Expedition"], ["Incursões", "Incursions"], ["Incursão", "Incursion"],
  ["Legião", "Legion"], ["Sindicato Imortal", "Immortal Syndicate"], ["Cartas de Adivinhação", "Divination Cards"],
  ["Espíritos Atormentados", "Tormented Spirits"], ["Espírito Atormentado", "Tormented Spirit"],
  ["Devorador de Mundos", "Eater of Worlds"], ["Exarca Cauterizado", "Searing Exarch"], ["Criador", "Shaper"], ["Ancião", "Elder"],
  ["Conquistadores", "Conquerors"], ["Anomalias do Atlas", "Atlas Anomalies"],
  ["Depósitos de Minério", "Ore Deposits"], ["Depósito de Minério", "Ore Deposit"],
  ["Ultimatos", "Ultimatums"], ["Ultimato", "Ultimatum"], ["Provações de Ascensão", "Trials of Ascendancy"],
  ["Provação de Ascensão", "Trial of Ascendancy"], ["Labirinto", "Labyrinth"],
  ["Mapas Sintetizados", "Synthesis Maps"], ["Mapa Sintetizado", "Synthesis Map"],
];
const KEEP_RE = KEEP.map(([pt, en]) => [new RegExp(`(?<![\\p{L}])${pt}(?![\\p{L}])`, "giu"), en] as const);
function keepKeywords(s: string): string {
  for (const [re, en] of KEEP_RE) s = s.replace(re, en);
  return s;
}

/**
 * One GGG stat -> Portuguese lines with the same numbers. A line break is either a wrap inside one
 * sentence or a second effect: the whole text is tried first, then line by line; unknown lines stay
 * in English.
 */
function tr(text: string): string[] {
  const t = plain(text);
  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const whole = t.replace(/\s+/g, " ").trim();
  // the table keeps several-line effects with their line breaks; wrapped sentences joined
  const found = lookup(lines.join("\n")) ?? lookup(whole);
  if (found !== undefined) return found.split("\n");
  if (lines.length < 2) {
    missing.add(whole);
    return [whole];
  }
  return lines.map((l) => {
    const p = lookup(l);
    if (p === undefined) missing.add(l);
    return p ?? l;
  });
}

const out = path.resolve(import.meta.dirname, "../docs/atlas");
mkdirSync(path.join(out, "img"), { recursive: true });

// GGG's sprite sheets at the largest zoom (0.5): world size = sprite size / 0.5
const ZOOM = "0.5";
const SHEETS = ["atlas-skills-4.webp", "atlas-skills-disabled-4.webp", "atlas-frame-4.webp", "atlas-group-background-4.webp", "atlas-mastery-4.webp", "atlas-background-4.webp"];
for (const file of SHEETS) {
  const res = await fetch(`https://raw.githubusercontent.com/grindinggear/atlastree-export/${tag}/assets/${file}`);
  if (!res.ok) throw new Error(`${file} HTTP ${res.status}`);
  writeFileSync(path.join(out, "img", file), Buffer.from(await res.arrayBuffer()));
}

for (const name of ["data", "ruthless"]) {
  const res = await fetch(`https://raw.githubusercontent.com/grindinggear/atlastree-export/${tag}/${name}.json`);
  if (!res.ok) throw new Error(`${name}.json HTTP ${res.status}`);
  const raw = (await res.json()) as Raw;
  const { skillsPerOrbit, orbitRadii } = raw.constants;
  const startId = Number(raw.nodes.root.out?.[0]);
  /** [x, y, w, h] of a sprite on the sheet of that category, or null. */
  const rect = (category: string, key: string | undefined): number[] | null => {
    const c = key ? raw.sprites[category]?.[ZOOM]?.coords[key] : undefined;
    return c ? [c.x, c.y, c.w, c.h] : null;
  };
  const iconCategory = ["normalActive", "notableActive", "keystoneActive", "startNode", "wormholeActive"];

  type Pos = { x: number; y: number; g?: number; o?: number; a?: number; r?: number };
  const pos = new Map<number, Pos>();
  for (const [key, n] of Object.entries(raw.nodes)) {
    const g = n.group !== undefined ? raw.groups[String(n.group)] : undefined;
    if (!g || key === "root") continue;
    const orbit = n.orbit ?? 0;
    const deg = orbitAngle(skillsPerOrbit[orbit] ?? 1, n.orbitIndex ?? 0);
    const r = orbitRadii[orbit] ?? 0;
    const a = (deg * Math.PI) / 180;
    pos.set(Number(key), { x: Math.round(g.x + r * Math.sin(a)), y: Math.round(g.y - r * Math.cos(a)), g: n.group, o: orbit, a: deg, r });
  }

  // Mechanics: one per mastery (the icon in the middle of each cluster); a node belongs to the mastery of
  // its group, else to a mechanic its name or effects name ("Shrine Chance" -> Shrines)
  const mechanics: string[] = [];
  const mechOfGroup = new Map<number, number>();
  for (const n of Object.values(raw.nodes)) {
    if (!n.isMastery || !n.name || n.group === undefined) continue;
    if (!mechanics.includes(n.name)) mechanics.push(n.name);
    mechOfGroup.set(n.group, mechanics.indexOf(n.name));
  }
  // too general to recognise by name ("Maps" is in every text)
  const GENERAL = new Set(["Maps", "Magic Monsters", "Rare Monsters", "Unique Monsters", "Gold", "Atlas Memories", "Beyond"]);
  const words = mechanics.map((m) => (GENERAL.has(m) ? null : new RegExp("\\b" + m.replace(/^The /, "").replace(/(es|s)$/, ""), "i")));
  const mechOf = (n: RawNode): number => {
    if (n.group !== undefined && mechOfGroup.has(n.group)) return mechOfGroup.get(n.group)!;
    const text = plain([n.name, ...(n.stats ?? [])].join(" "));
    const found = words.findIndex((re) => re !== null && re.test(text));
    if (found >= 0) return found;
    // the general ones by the node's name only ("Map Rare Monsters", "Map Drop Chance")
    const name = n.name ?? "";
    for (const [re, mech] of [[/Rare Monster/, "Rare Monsters"], [/Magic Monster/, "Magic Monsters"], [/Unique Monster/, "Unique Monsters"], [/^Map |Item Rarity|Item Quantity/, "Maps"]] as const) {
      if (re.test(name) && mechanics.includes(mech)) return mechanics.indexOf(mech);
    }
    return -1;
  };

  // [id, x, y, kind, mechanic | -1, ...icon rect]: 0 small, 1 notable, 2 keystone, 3 start, 4 gateway
  const nodes: number[][] = [];
  const masteries: number[][] = []; // [x, y, mechanic, ...icon rect]
  // id -> { n: name, m: mechanic, pt / en: { s: stats, r: reminder, f: flavour, v: variants (lists of stats) } }
  type Texts = { s: string[]; r: string[]; f: string[]; v?: string[][] };
  const info: Record<number, { n: string; pt: Texts; en: Texts }> = {};
  const lines = (list: string[] | undefined) => (list ?? []).flatMap((t) => plain(t).split(/\n/).map((l) => l.trim()).filter(Boolean));
  const edges: (number[])[] = [];
  const shown = (id: number) => pos.has(id) && !raw.nodes[id]?.isMastery;
  for (const [key, n] of Object.entries(raw.nodes)) {
    const id = Number(key);
    if (key === "root") continue;
    if (n.isMastery && pos.has(id)) {
      const r = rect("mastery", n.icon);
      if (r) masteries.push([pos.get(id)!.x, pos.get(id)!.y, mechanics.indexOf(n.name ?? ""), ...r]);
    }
    if (!shown(id)) continue;
    const p = pos.get(id)!;
    const kind = id === startId ? 3 : n.isWormhole ? 4 : n.isKeystone ? 2 : n.isNotable ? 1 : 0;
    const iconKey = kind === 3 ? "AtlasPassiveSkillScreenStart" : kind === 4 ? "Wormhole" : n.icon;
    nodes.push([id, p.x, p.y, kind, kind === 3 ? -1 : mechOf(n), ...(rect(iconCategory[kind], iconKey) ?? [])]);
    if (id !== startId) {
      const pt: Texts = { s: (n.stats ?? []).flatMap(tr), r: (n.reminderText ?? []).flatMap(tr), f: (n.flavourText ?? []).flatMap(tr) };
      const en: Texts = { s: lines(n.stats), r: lines(n.reminderText), f: lines(n.flavourText) };
      if (n.variantEffects) {
        pt.v = n.variantEffects.map((v) => v.stats.flatMap(tr));
        en.v = n.variantEffects.map((v) => lines(v.stats));
      }
      info[id] = { n: n.name ?? "", pt, en };
    }
    for (const t of n.out ?? []) {
      const to = Number(t);
      if (!shown(to)) continue;
      // two gateways are linked by their effect, not by a line across the atlas
      if (n.isWormhole && raw.nodes[t]?.isWormhole) {
        edges.push([id, to, -1]);
        continue;
      }
      const q = pos.get(to)!;
      // same group and orbit: an arc around the group centre, the short way round
      if (p.g === q.g && p.o === q.o && p.r && p.a !== undefined && q.a !== undefined) {
        const delta = (q.a - p.a + 360) % 360;
        edges.push([id, to, p.r, delta <= 180 ? 1 : 0]);
      } else edges.push([id, to]);
    }
  }
  const groups = Object.values(raw.groups).flatMap((g) => {
    const r = g.background && rect("groupBackground", g.background.image);
    return r ? [[Math.round(g.x + (g.background!.offsetX ?? 0)), Math.round(g.y + (g.background!.offsetY ?? 0)), ...r]] : [];
  });
  const frames = Object.fromEntries(Object.entries(raw.sprites.frame[ZOOM].coords).map(([k, c]) => [k, [c.x, c.y, c.w, c.h]]));
  const sprites = { frames, background: rect("atlasBackground", "AtlasPassiveBackground") };
  const tree = { version: tag, points: raw.points.totalPoints, start: startId, nodes, edges, info, groups, masteries, sprites, mechanics };
  writeFileSync(path.join(out, `${name}.json`), JSON.stringify(tree));
  const loose = nodes.filter((n) => n[3] !== 3 && n[4] === -1).length;
  console.log(`${name}: ${nodes.length} nodes, ${edges.length} links, ${raw.points.totalPoints} points, ${mechanics.length} mechanics, ${loose} nodes in none`);
}

console.log(`${missing.size} texts without a translation (shown in English):`);
for (const s of missing) console.log("  " + s);
