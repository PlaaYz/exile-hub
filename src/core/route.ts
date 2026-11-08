// Parser for the campaign route DSL used by exile-leveling (MIT, (c) HeartofPhos).
// Format: one step per line, {fragment|arg|arg} tokens, "#sub" detail lines, "#section Act N",
// "#ifdef/#ifndef/#else/#endif" blocks, and trailing "#comment" annotations.

import type { Fragment, Step } from "../shared/types";

export interface AreaInfo {
  id: string;
  name: string;
  act: number;
  level: number;
  has_waypoint: boolean;
  is_town_area: boolean;
}
export interface QuestInfo {
  id: string;
  name: string;
}
export interface Lookups {
  areas: Record<string, AreaInfo>;
  quests: Record<string, QuestInfo>;
}

const FRAGMENT_RE = /\{([^{}]*)\}/g;

export function parseFragments(text: string, lk: Lookups): Fragment[] {
  const out: Fragment[] = [];
  let last = 0;
  for (const m of text.matchAll(FRAGMENT_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", text: text.slice(last, idx) });
    out.push(parseFragment(m[1], lk));
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

function areaName(id: string, lk: Lookups): string {
  return lk.areas[id]?.name ?? id;
}

function parseFragment(inner: string, lk: Lookups): Fragment {
  const [type, ...args] = inner.split("|");
  switch (type) {
    case "enter":
      return { kind: "enter", areaId: args[0], name: areaName(args[0], lk) };
    case "area":
      return { kind: "area", areaId: args[0], name: areaName(args[0], lk) };
    case "waypoint":
      return args.length
        ? { kind: "waypoint", areaId: args[0], name: areaName(args[0], lk) }
        : { kind: "waypoint" };
    case "waypoint_get":
      return { kind: "waypoint_get" };
    case "quest":
      return { kind: "quest", ids: args, name: lk.quests[args[0]]?.name ?? args[0] };
    case "kill":
    case "arena":
    case "quest_text":
    case "generic":
    case "reward_quest":
      return { kind: "label", style: type, text: args.join("|") };
    case "reward_vendor":
      return { kind: "reward_vendor", text: args[0] ?? "", cost: args[1] };
    case "logout":
      return { kind: "logout" };
    case "trial":
      return { kind: "trial" };
    case "crafting":
      return { kind: "crafting" };
    case "dir":
      return { kind: "dir", degrees: Number(args[0]) || 0 };
    case "portal":
      return { kind: "portal", mode: args[0] ?? "use" };
    case "ascend":
      return { kind: "ascend", version: args[0] ?? "" };
    case "copy":
      return { kind: "copy", text: args.join("|") };
    default:
      return { kind: "text", text: `{${inner}}` };
  }
}

/** Splits "text #comment" at the first '#' that is outside braces and preceded by whitespace. */
function splitComment(s: string): [string, string | undefined] {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (c === "#" && depth === 0 && (i === 0 || /\s/.test(s[i - 1]))) {
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    }
  }
  return [s.trim(), undefined];
}

function arrivalOf(fragments: Fragment[]): string | undefined {
  for (const f of fragments) if (f.kind === "enter") return f.areaId;
  for (const f of fragments) if (f.kind === "waypoint" && f.areaId) return f.areaId;
  return undefined;
}

export function parseRoute(text: string, lk: Lookups, defines: ReadonlySet<string>): Step[] {
  const steps: Step[] = [];
  // conditional stack: each entry says whether the current branch is active
  const stack: { parentActive: boolean; cond: boolean; inElse: boolean }[] = [];
  const active = (): boolean => stack.every((s) => (s.inElse ? !s.cond : s.cond));
  let act = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#ifdef ") || line.startsWith("#ifndef ")) {
      const neg = line.startsWith("#ifndef ");
      const name = line.slice(neg ? 8 : 7).trim();
      const has = defines.has(name);
      stack.push({ parentActive: active(), cond: neg ? !has : has, inElse: false });
      continue;
    }
    if (line === "#else") {
      const top = stack[stack.length - 1];
      if (top) top.inElse = true;
      continue;
    }
    if (line === "#endif") {
      stack.pop();
      continue;
    }
    if (!active()) continue;

    if (line.startsWith("#section")) {
      const m = /Act\s+(\d+)/i.exec(line);
      if (m) act = Number(m[1]);
      continue;
    }
    if (line.startsWith("#sub ")) {
      const last = steps[steps.length - 1];
      if (last) last.subs.push(parseFragments(splitComment(line.slice(5))[0], lk));
      continue;
    }
    if (line.startsWith("#")) continue; // full-line comment

    let [body, comment] = splitComment(line);
    if (body.startsWith("➞")) body = body.slice(1).trim();
    const fragments = parseFragments(body, lk);
    steps.push({
      id: steps.length,
      act,
      fragments,
      subs: [],
      comment,
      arrival: arrivalOf(fragments),
    });
  }
  return steps;
}
