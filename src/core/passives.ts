// Passive tree progress: what Client.txt says the character allocated vs the PoB build.
//
// The log names passives by an internal id and a display name ("mark_generic_notable1226, name:
// Mark the Prey"); PoB and GGG's skilltree-export use numeric node ids. Notables and keystones have
// unique names, so they are matched by name; small nodes ("Attack Damage") are matched by count.
// The log does not say which character allocated a point: it is attributed to the character that
// levels up in the same game session (the pid in "Client <pid>" changes on every game start).
import type { LogEvent } from "./clientLog";
import type { PobBuild, TreeLayout } from "../shared/types";

// ---- tree data ------------------------------------------------------------------

export interface TreeNode {
  id: number;
  name: string;
  notable?: true;
  keystone?: true;
  mastery?: true;
  /** ascendancy name for ascendancy nodes */
  asc?: string;
  /** class start or ascendancy start: not a point */
  start?: true;
  links: number[];
  stats: string[];
  /** position on the tree (GGG coordinates, y down); absent for nodes without a group */
  x?: number;
  y?: number;
  /** group, orbit and angle (degrees): links between nodes on the same orbit are drawn as arcs */
  g?: number;
  o?: number;
  a?: number;
  /** orbit radius */
  r?: number;
}

/** Bumped when the slim format changes: older caches are fetched again. */
export const kTreeFormat = 2;

export interface PassiveTree {
  version: string;
  /** kTreeFormat of the cache (missing = format 1, no positions) */
  format?: number;
  nodes: Record<number, TreeNode>;
  /** base class name -> its start node */
  classStarts: Record<string, number>;
}

interface RawNode {
  skill?: number;
  name?: string;
  isNotable?: boolean;
  isKeystone?: boolean;
  isMastery?: boolean;
  ascendancyName?: string;
  isAscendancyStart?: boolean;
  classStartIndex?: number;
  isProxy?: boolean;
  out?: string[];
  in?: string[];
  stats?: string[];
  group?: number;
  orbit?: number;
  orbitIndex?: number;
}

interface RawTree {
  tree?: string;
  classes?: { name: string }[];
  nodes: Record<string, RawNode>;
  groups?: Record<string, { x: number; y: number }>;
  constants?: { skillsPerOrbit?: number[]; orbitRadii?: number[] };
}

// orbits with 16 and 40 slots are not evenly spaced (same tables as Path of Building)
const ANGLES_16 = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
const ANGLES_40 = [
  0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135, 140, 150, 160, 170, 180, 190, 200, 210, 220, 225, 230,
  240, 250, 260, 270, 280, 290, 300, 310, 315, 320, 330, 340, 350,
];

/** Degrees of slot `index` on an orbit with `slots` positions. */
export function orbitAngle(slots: number, index: number): number {
  if (slots === 16) return ANGLES_16[index] ?? 0;
  if (slots === 40) return ANGLES_40[index] ?? 0;
  return (360 / slots) * index;
}

/** Shrinks GGG's skilltree-export data.json (~6.6 MB) to what the comparison and the map need. */
export function slimTree(raw: RawTree, version: string): PassiveTree {
  const nodes: Record<number, TreeNode> = {};
  const classStarts: Record<string, number> = {};
  const perOrbit = raw.constants?.skillsPerOrbit ?? [1, 6, 16, 16, 40, 72, 72];
  const radii = raw.constants?.orbitRadii ?? [0, 82, 162, 335, 493, 662, 846];
  for (const [key, n] of Object.entries(raw.nodes)) {
    const id = n.skill ?? Number(key);
    if (!Number.isFinite(id) || !n.name || n.isProxy) continue;
    const node: TreeNode = {
      id,
      name: n.name,
      links: [...(n.out ?? []), ...(n.in ?? [])].map(Number).filter(Number.isFinite),
      stats: n.stats ?? [],
    };
    const g = n.group !== undefined ? raw.groups?.[String(n.group)] : undefined;
    if (g) {
      const orbit = n.orbit ?? 0;
      const deg = orbitAngle(perOrbit[orbit] ?? 1, n.orbitIndex ?? 0);
      const a = (deg * Math.PI) / 180;
      const r = radii[orbit] ?? 0;
      node.x = Math.round(g.x + r * Math.sin(a));
      node.y = Math.round(g.y - r * Math.cos(a));
      if (orbit > 0) Object.assign(node, { g: n.group, o: orbit, a: deg, r });
    }
    if (n.isNotable) node.notable = true;
    if (n.isKeystone) node.keystone = true;
    if (n.isMastery) node.mastery = true;
    if (n.ascendancyName) node.asc = n.ascendancyName;
    if (n.isAscendancyStart || n.classStartIndex !== undefined) node.start = true;
    if (n.classStartIndex !== undefined && raw.classes?.[n.classStartIndex]) {
      classStarts[raw.classes[n.classStartIndex].name] = id;
    }
    nodes[id] = node;
  }
  // links are listed one way in the export: make them two-way
  for (const n of Object.values(nodes)) {
    for (const l of n.links) {
      const o = nodes[l];
      if (o && !o.links.includes(n.id)) o.links.push(n.id);
    }
  }
  return { version, format: kTreeFormat, nodes, classStarts };
}

/** Main-tree geometry for drawing (no ascendancy, masteries or nodes without a position). */
export function treeLayout(tree: PassiveTree): TreeLayout {
  const shown = (n: TreeNode | undefined): n is TreeNode & { x: number; y: number } =>
    !!n && n.x !== undefined && n.y !== undefined && !n.asc && !n.mastery;
  const nodes: TreeLayout["nodes"] = [];
  const edges: TreeLayout["edges"] = [];
  const names: TreeLayout["names"] = {};
  for (const n of Object.values(tree.nodes)) {
    if (!shown(n)) continue;
    nodes.push([n.id, n.x, n.y, n.start ? 3 : n.keystone ? 2 : n.notable ? 1 : 0]);
    names[n.id] = n.name;
    // class starts fan out to every class: those spokes are noise on a map
    for (const l of n.links) {
      const m = tree.nodes[l];
      if (l <= n.id || !shown(m) || (n.start && m.start)) continue;
      // same group and orbit: an arc around the group centre, the short way round
      if (n.g !== undefined && n.g === m.g && n.o === m.o && n.r && n.a !== undefined && m.a !== undefined) {
        const delta = (m.a - n.a + 360) % 360;
        edges.push([n.id, l, n.r, delta <= 180 ? 1 : 0]);
      } else {
        edges.push([n.id, l]);
      }
    }
  }
  return { nodes, edges, names };
}

// ---- what the character allocated -------------------------------------------------

export type Allocated = Map<string, number>; // passive name -> how many nodes with that name

/** Character tree ids are lower snake case ("life_armour_evasion_notable1853"). */
export function isCharacterPassiveId(id: string): boolean {
  return !id.startsWith("atlas_") && /^[a-z]/.test(id);
}

/**
 * Points a character of this level can have: one per level after the first, 24 from quests and
 * 8 ascendancy points. More than that seen in the log means points of another character leaked in.
 */
export function pointBudget(level: number): number {
  return Math.max(0, level - 1) + 24 + 8;
}

export function pointsIn(a: Allocated): number {
  let n = 0;
  for (const c of a.values()) n += c;
  return n;
}

/**
 * Net points a character may allocate without leveling up (quest rewards, points left unspent).
 * More than that in one go means another character is being played in the same game session (the
 * log has no "character selected" line): stop attributing until the next level-up.
 */
export const kMaxPointsWithoutLevel = 8;

export class PassiveTracker {
  private readonly byChar = new Map<string, Allocated>();
  private pid: number | null = null;
  private char: string | null = null;
  /** allocations seen in this game session before any level-up told us the character */
  private pending: { allocated: boolean; name: string }[] = [];
  private netSinceLevel = 0;
  /** the character was "lost" (too many points without a level-up): pending ones are not theirs */
  private lost = false;

  allocated(character: string | null): Allocated {
    return (character && this.byChar.get(character)) || new Map();
  }

  /** Characters with at least one allocation seen. */
  characters(): string[] {
    return [...this.byChar.keys()];
  }

  private session(pid: number): void {
    if (pid !== this.pid) {
      this.pid = pid;
      this.char = null;
      this.pending = [];
      this.lost = false;
      this.netSinceLevel = 0;
    }
  }

  private apply(char: string, allocated: boolean, name: string): void {
    const m = this.byChar.get(char) ?? new Map<string, number>();
    const n = (m.get(name) ?? 0) + (allocated ? 1 : -1);
    if (n > 0) m.set(name, n);
    else m.delete(name);
    this.byChar.set(char, m);
  }

  /** Returns true when an allocation changed for a known character. */
  feed(ev: LogEvent): boolean {
    if (ev.type === "levelup") {
      this.session(ev.pid);
      // a name seen again at level 2 is a new character (the old one was deleted)
      if (ev.level <= 2) this.byChar.delete(ev.character);
      this.char = ev.character;
      this.netSinceLevel = 0;
      const p = this.lost ? [] : this.pending;
      this.pending = [];
      this.lost = false;
      for (const a of p) this.apply(ev.character, a.allocated, a.name);
      return p.length > 0;
    }
    if (ev.type === "passive") {
      // other trees share the log line: Atlas ("atlas_...") and Genesis ("CurrencyNode3d"...)
      if (!isCharacterPassiveId(ev.skillId)) return false;
      this.session(ev.pid);
      this.netSinceLevel += ev.allocated ? 1 : -1;
      if (this.char && this.netSinceLevel > kMaxPointsWithoutLevel) {
        this.char = null; // another character is being played
        this.lost = true;
      }
      if (this.char) {
        this.apply(this.char, ev.allocated, ev.name);
        return true;
      }
      if (!this.lost) this.pending.push({ allocated: ev.allocated, name: ev.name });
    }
    return false;
  }
}

// ---- comparison --------------------------------------------------------------------

export interface MissingNode {
  id: number;
  name: string;
  kind: "notable" | "keystone";
  stats: string[];
  /** points needed to reach it along the build's own nodes; null when not reachable that way */
  distance: number | null;
}

export interface TreeProgress {
  /** build points on the main tree (no ascendancy, masteries or starts) */
  buildPoints: number;
  /** of those, how many the character has */
  donePoints: number;
  /** build notables/keystones still missing, nearest first */
  missing: MissingNode[];
  /** ascendancy notables of the build still missing */
  ascMissing: string[];
  /** notables/keystones the character has that the build does not use */
  offBuild: string[];
  /** for the tree map: the build's main-tree nodes and which of them the character has */
  buildIds: number[];
  haveIds: number[];
  /** the points to take next, in order: the path to the nearest missing notable/keystone */
  nextPath: number[];
  /** class start node of the build (where an empty tree begins) */
  startId: number | null;
}

const isPoint = (n: TreeNode) => !n.start && !n.mastery;
/** How many points ahead the "take next" path goes. */
export const kNextPoints = 15;

export function compareTree(tree: PassiveTree, build: PobBuild, allocated: Allocated): TreeProgress {
  const left = new Map(allocated); // counts still available for matching
  const take = (name: string) => {
    const c = left.get(name) ?? 0;
    if (c <= 0) return false;
    left.set(name, c - 1);
    return true;
  };
  const buildNodes = build.treeNodes.map((id) => tree.nodes[id]).filter((n): n is TreeNode => !!n && isPoint(n));
  const main = buildNodes.filter((n) => !n.asc);
  const asc = buildNodes.filter((n) => n.asc);

  // big nodes first (unique names), then small ones by count
  const have = new Set<number>();
  const order = [...main].sort((a, b) => Number(!!(b.notable || b.keystone)) - Number(!!(a.notable || a.keystone)));
  for (const n of order) if (take(n.name)) have.add(n.id);
  const ascHave = new Set(asc.filter((n) => take(n.name)).map((n) => n.id));

  // distance: BFS from what the character has (or the class start) through build nodes only
  const inBuild = new Set(main.map((n) => n.id));
  const start = tree.classStarts[build.className];
  const bfs = (sources: Iterable<number>) => {
    const dist = new Map<number, number>();
    const parent = new Map<number, number>();
    const queue: number[] = [];
    for (const id of sources) {
      dist.set(id, 0);
      queue.push(id);
    }
    if (start !== undefined && !dist.has(start)) {
      dist.set(start, 0);
      queue.push(start);
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      for (const l of tree.nodes[cur]?.links ?? []) {
        if (dist.has(l) || !inBuild.has(l)) continue;
        dist.set(l, dist.get(cur)! + 1);
        parent.set(l, cur);
        queue.push(l);
      }
    }
    const pathTo = (id: number): number[] => {
      const path: number[] = [];
      for (let cur: number | undefined = id; cur !== undefined && dist.get(cur)! > 0; cur = parent.get(cur)) path.unshift(cur);
      return path;
    };
    return { dist, order: queue, pathTo };
  };
  const { dist } = bfs(have);

  const missing: MissingNode[] = main
    .filter((n) => (n.notable || n.keystone) && !have.has(n.id))
    .map((n) => ({
      id: n.id,
      name: n.name,
      kind: n.keystone ? ("keystone" as const) : ("notable" as const),
      stats: n.stats,
      distance: dist.get(n.id) ?? null,
    }))
    .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9) || a.name.localeCompare(b.name));

  const buildBigNames = new Set(buildNodes.filter((n) => n.notable || n.keystone).map((n) => n.name));
  const bigNames = new Set(Object.values(tree.nodes).filter((n) => n.notable || n.keystone).map((n) => n.name));
  const offBuild = [...left]
    .filter(([name, c]) => c > 0 && bigNames.has(name) && !buildBigNames.has(name))
    .map(([name]) => name)
    .sort();

  // next: walk to the nearest missing notable/keystone, then from there to the next one, and so on
  // (when no notable is left, the nearest small nodes); like following Path of Building's tree
  const missingBig = new Set(missing.map((m) => m.id));
  const taken = new Set(have);
  const nextPath: number[] = [];
  while (nextPath.length < kNextPoints) {
    const step = bfs(taken);
    const free = step.order.filter((id) => !taken.has(id) && (step.dist.get(id) ?? 0) > 0);
    const target = free.find((id) => missingBig.has(id)) ?? free[0];
    if (target === undefined) break;
    for (const id of step.pathTo(target)) {
      if (nextPath.length >= kNextPoints) break;
      nextPath.push(id);
      taken.add(id);
    }
  }

  return {
    buildPoints: main.length,
    donePoints: have.size,
    missing,
    ascMissing: asc.filter((n) => n.notable && !ascHave.has(n.id)).map((n) => n.name),
    offBuild,
    buildIds: main.map((n) => n.id),
    haveIds: [...have],
    nextPath,
    startId: start ?? null,
  };
}
