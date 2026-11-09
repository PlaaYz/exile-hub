// League challenges: the list (with a difficulty and how-to tips we write for each league), the
// player's own progress (ticked by hand: GGG has no API for completed challenges) and the order
// shown: what is left from easiest to hardest, then what is done.

export interface Challenge {
  id: string;
  name: string;
  /** what the game asks, short */
  description: string;
  /** 1 (very easy) .. 5 (very hard) */
  difficulty: number;
  /** "campanha", "mapas", "bosses", "crafting", "liga"... */
  category: string;
  /** how to do it, in a few lines */
  tips: string[];
  /** sub-objectives, when the challenge counts several things */
  parts?: string[];
  /** how many parts complete it (default all) */
  need?: number;
}

export interface ChallengeList {
  league: string;
  /** e.g. "3.30" */
  patch: string;
  updated: string;
  /** challenges done for each reward (e.g. [12, 24, 32, 36]) */
  rewards: number[];
  challenges: Challenge[];
  /** where the challenge texts were checked */
  source?: string;
}

/** Ticked by the player, per league. */
export interface ChallengeProgress {
  done: string[];
  /** challenge id -> indexes of the parts done */
  parts: Record<string, number[]>;
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

/** Validates a downloaded list (it comes from the network: anything malformed is dropped). */
export function parseChallengeList(raw: unknown): ChallengeList | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const league = str(r.league, 80);
  const patch = str(r.patch, 20);
  if (!league || !patch || !Array.isArray(r.challenges)) return null;
  const seen = new Set<string>();
  const challenges: Challenge[] = [];
  for (const c of r.challenges as Record<string, unknown>[]) {
    const id = str(c?.id, 40);
    const name = str(c?.name, 120);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const difficulty = typeof c.difficulty === "number" ? Math.min(5, Math.max(1, Math.round(c.difficulty))) : 3;
    const parts = Array.isArray(c.parts) ? c.parts.filter((p): p is string => typeof p === "string" && p.length <= 200).slice(0, 60) : undefined;
    const need = typeof c.need === "number" && parts ? Math.min(parts.length, Math.max(1, Math.round(c.need))) : undefined;
    challenges.push({
      id,
      name,
      description: str(c.description, 400) ?? "",
      difficulty,
      category: str(c.category, 40) ?? "",
      tips: Array.isArray(c.tips) ? c.tips.filter((t): t is string => typeof t === "string" && t.length <= 400).slice(0, 8) : [],
      ...(parts?.length ? { parts } : {}),
      ...(need ? { need } : {}),
    });
  }
  const rewards = Array.isArray(r.rewards) ? r.rewards.filter((n): n is number => typeof n === "number" && n > 0).slice(0, 10) : [];
  return { league, patch, updated: str(r.updated, 30) ?? "", rewards, challenges, ...(str(r.source, 200) ? { source: r.source as string } : {}) };
}

export function partsNeeded(c: Challenge): number {
  return c.parts ? (c.need ?? c.parts.length) : 0;
}

/** Done when ticked, or when enough of its parts are ticked. */
export function isDone(c: Challenge, p: ChallengeProgress): boolean {
  if (p.done.includes(c.id)) return true;
  const need = partsNeeded(c);
  return need > 0 && (p.parts[c.id]?.length ?? 0) >= need;
}

/**
 * Left to do from easiest to hardest (ties: closest to done first, then the list's order), then
 * the completed ones.
 */
export function orderChallenges(list: ChallengeList, p: ChallengeProgress): { todo: Challenge[]; done: Challenge[] } {
  const index = new Map(list.challenges.map((c, i) => [c.id, i]));
  const left = (c: Challenge) => {
    const need = partsNeeded(c);
    return need ? 1 - Math.min(1, (p.parts[c.id]?.length ?? 0) / need) : 1;
  };
  const todo = list.challenges
    .filter((c) => !isDone(c, p))
    .sort((a, b) => a.difficulty - b.difficulty || left(a) - left(b) || index.get(a.id)! - index.get(b.id)!);
  const done = list.challenges.filter((c) => isDone(c, p));
  return { todo, done };
}

/** Applies a tick from the UI; returns the new progress (unknown ids / parts are ignored). */
export function setChallenge(list: ChallengeList, p: ChallengeProgress, id: string, done: boolean, part?: number): ChallengeProgress {
  const c = list.challenges.find((x) => x.id === id);
  if (!c) return p;
  if (part !== undefined) {
    if (!c.parts || !Number.isInteger(part) || part < 0 || part >= c.parts.length) return p;
    const cur = new Set(p.parts[id] ?? []);
    if (done) cur.add(part);
    else cur.delete(part);
    return { ...p, parts: { ...p.parts, [id]: [...cur].sort((a, b) => a - b) } };
  }
  const set = new Set(p.done);
  if (done) set.add(id);
  else set.delete(id);
  return { ...p, done: [...set] };
}

export function emptyProgress(): ChallengeProgress {
  return { done: [], parts: {} };
}
