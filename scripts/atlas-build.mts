// Builds the site's Atlas tree files from GGG's official export (github.com/grindinggear/atlastree-export)
// and the owner's pt-BR translation table (English text with numbers as "#" -> Portuguese).
// Usage: npx vite-node scripts/atlas-build.mts <tag e.g. 3.30.0>
// The table is data/atlas-ptbr.json (from the owner's atlas-ptbr project): add the texts it reports missing.
// Writes docs/atlas/{data,ruthless}.json and prints the texts left untranslated (shown in English).
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
}
interface Raw {
  nodes: Record<string, RawNode>;
  groups: Record<string, { x: number; y: number }>;
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

function lookup(line: string): string | undefined {
  const key = line.replace(NUM, "#");
  const p = PTBR[key] ?? FLAT.get(key.replace(/\s+/g, " "));
  if (p === undefined) return undefined;
  const nums = line.match(NUM) ?? [];
  let i = 0;
  return p.replace(/#/g, () => nums[i++] ?? "#");
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
mkdirSync(out, { recursive: true });

for (const name of ["data", "ruthless"]) {
  const res = await fetch(`https://raw.githubusercontent.com/grindinggear/atlastree-export/${tag}/${name}.json`);
  if (!res.ok) throw new Error(`${name}.json HTTP ${res.status}`);
  const raw = (await res.json()) as Raw;
  const { skillsPerOrbit, orbitRadii } = raw.constants;
  const startId = Number(raw.nodes.root.out?.[0]);

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

  // [id, x, y, kind]: 0 small, 1 notable, 2 keystone, 3 start, 4 gateway (masteries are only group decoration)
  const nodes: [number, number, number, number][] = [];
  // id -> [name, stats, reminder, flavour, variants (each a list of stats) | null, English text for the search]
  const info: Record<number, [string, string[], string[], string[], string[][] | null, string]> = {};
  const edges: (number[])[] = [];
  const shown = (id: number) => pos.has(id) && !raw.nodes[id]?.isMastery;
  for (const [key, n] of Object.entries(raw.nodes)) {
    const id = Number(key);
    if (key === "root" || !shown(id)) continue;
    const p = pos.get(id)!;
    const kind = id === startId ? 3 : n.isWormhole ? 4 : n.isKeystone ? 2 : n.isNotable ? 1 : 0;
    nodes.push([id, p.x, p.y, kind]);
    if (id !== startId) {
      const variants = n.variantEffects?.map((v) => v.stats.flatMap(tr)) ?? null;
      const en = plain([n.name, ...(n.stats ?? []), ...(n.variantEffects?.flatMap((v) => v.stats) ?? [])].join(" ")).replace(/\s+/g, " ");
      info[id] = [n.name ?? "", (n.stats ?? []).flatMap(tr), (n.reminderText ?? []).flatMap(tr), (n.flavourText ?? []).flatMap(tr), variants, en];
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
  const tree = { version: tag, points: raw.points.totalPoints, start: startId, nodes, edges, info };
  writeFileSync(path.join(out, `${name}.json`), JSON.stringify(tree));
  console.log(`${name}: ${nodes.length} nodes, ${edges.length} links, ${raw.points.totalPoints} points`);
}

console.log(`${missing.size} texts without a translation (shown in English):`);
for (const s of missing) console.log("  " + s);
