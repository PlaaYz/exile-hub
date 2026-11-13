// Path of Building import: code (url-safe base64 of zlib-deflated XML) -> structured build.

// Pure JS (fflate) instead of node:zlib so the same code runs in Node, Electron and a webview.
import { inflateSync, strFromU8, unzlibSync } from "fflate";
import type { PobBuild, PobGem, PobSkillGroup } from "../shared/types";
import { tr } from "../shared/i18n";

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodePobCode(code: string): string {
  const b64 = code.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!b64) throw new Error(tr("código do PoB vazio", "empty PoB code"));
  let bytes: Uint8Array;
  try {
    bytes = base64Bytes(b64);
  } catch {
    throw new Error(tr("não é um código do PoB válido (falha ao descompactar)", "not a valid PoB code (could not decompress)"));
  }
  try {
    return strFromU8(unzlibSync(bytes));
  } catch {
    try {
      return strFromU8(inflateSync(bytes));
    } catch {
      throw new Error(tr("não é um código do PoB válido (falha ao descompactar)", "not a valid PoB code (could not decompress)"));
    }
  }
}

function unescapeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = unescapeXml(m[2]);
  return out;
}

/**
 * A build's stages ("Level 30", "Level 60", "Endgame"...): PoB keeps passive trees, skill sets and item
 * sets in three lists side by side; the stages are the trees, and the skill / item set of a stage is the
 * one with the same title, else the one in the same position, else the active one.
 */
function specsOf(xml: string): { titles: string[]; active: number; nodes: string[] } {
  const treeBlock = /<Tree\b([^>]*)>([\s\S]*?)<\/Tree>/.exec(xml);
  if (!treeBlock) return { titles: [], active: 0, nodes: [] };
  const specs = [...treeBlock[2].matchAll(/<Spec\b([^>]*?)(?:\/>|>)/g)].map((m) => attrs(m[1]));
  const active = Math.min(Math.max((Number(attrs(treeBlock[1]).activeSpec) || 1) - 1, 0), Math.max(specs.length - 1, 0));
  return { titles: specs.map((s, i) => s.title || `${tr("Árvore", "Tree")} ${i + 1}`), active, nodes: specs.map((s) => s.nodes ?? "") };
}

/** Which set of a list goes with stage `spec` (titled `title`): same title, else same position, else the active one. */
export function setForStage<T extends { title?: string }>(sets: T[], spec: number, title: string, active: T | undefined): T | undefined {
  const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();
  return sets.find((s) => norm(s.title) !== "" && norm(s.title) === norm(title)) ?? sets[spec] ?? active ?? sets[0];
}

/** The tree list of the export: stage titles and which one PoB had open. */
export function pobStages(xml: string): { titles: string[]; active: number } {
  const { titles, active } = specsOf(xml);
  return { titles, active };
}

export function parsePobXml(xml: string, stage?: number): PobBuild {
  if (!/<PathOfBuilding/.test(xml)) throw new Error(tr("não é uma exportação do Path of Building", "not a Path of Building export"));

  const buildTag = /<Build\b([^>]*)>/.exec(xml);
  const b = buildTag ? attrs(buildTag[1]) : {};

  const specs = specsOf(xml);
  const spec = stage !== undefined && stage >= 0 && stage < specs.titles.length ? stage : specs.active;
  const title = specs.titles[spec] ?? "";

  // --- skills: the stage's skill set (the active one when no stage was picked)
  let skillsXml = "";
  const skillsBlock = /<Skills\b([^>]*)>([\s\S]*?)<\/Skills>/.exec(xml);
  if (skillsBlock) {
    const activeId = attrs(skillsBlock[1]).activeSkillSet;
    const sets = [...skillsBlock[2].matchAll(/<SkillSet\b([^>]*)>([\s\S]*?)<\/SkillSet>/g)].map((m) => {
      const a = attrs(m[1]);
      return { id: a.id, title: a.title, body: m[2] };
    });
    if (sets.length) {
      const active = sets.find((s) => s.id === activeId);
      const pick = (stage === undefined ? active : setForStage(sets, spec, title, active)) ?? sets[0];
      skillsXml = pick.body;
    } else {
      skillsXml = skillsBlock[2];
    }
  }

  const groups: PobSkillGroup[] = [];
  for (const m of skillsXml.matchAll(/<Skill\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Skill>)/g)) {
    const a = attrs(m[1]);
    const gems: PobGem[] = [];
    for (const g of (m[2] ?? "").matchAll(/<Gem\b([^>]*?)\/?>/g)) {
      const ga = attrs(g[1]);
      const name = ga.nameSpec || ga.skillId || "?";
      gems.push({
        name,
        level: Number(ga.level) || 1,
        quality: Number(ga.quality) || 0,
        enabled: ga.enabled !== "false",
        support: /Support/.test(ga.gemId ?? ga.skillId ?? ""),
        requiredLevel: null,
      });
    }
    if (gems.length === 0) continue;
    groups.push({
      label: a.label || gems.find((g) => !g.support)?.name || "Grupo sem nome",
      slot: a.slot ?? null,
      enabled: a.enabled !== "false",
      gems,
    });
  }

  // --- passive tree: the stage's spec
  const nodes = specs.nodes[spec] ?? "";
  const treeNodes = nodes ? nodes.split(",").map(Number).filter((n) => Number.isFinite(n)) : [];

  return {
    className: b.className ?? "",
    ascendClass: b.ascendClassName ?? "",
    level: Number(b.level) || 1,
    groups,
    treeNodes,
    stages: specs.titles,
    stage: spec,
  };
}

export function importPob(code: string, stage?: number): PobBuild {
  return parsePobXml(decodePobCode(code), stage);
}

/** Fills `requiredLevel` on gems using a name -> required level table. */
export function applyGemLevels(build: PobBuild, levels: ReadonlyMap<string, number>): PobBuild {
  return {
    ...build,
    groups: build.groups.map((g) => ({
      ...g,
      gems: g.gems.map((gem) => ({
        ...gem,
        requiredLevel: levels.get(gem.name.toLowerCase()) ?? null,
      })),
    })),
  };
}

export function gemLevelTable(
  gems: Record<string, { name: string; required_level: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of Object.values(gems)) out.set(g.name.toLowerCase(), g.required_level);
  return out;
}

/** Turns pastebin / pobb.in links into raw URLs; anything else is treated as a PoB code. */
/**
 * Clipboard text worth trying as a build: a pobb.in / pastebin link, or a long run of url-safe
 * base64 (a raw PoB export code). The import itself decides; failures are ignored by the caller.
 */
export function looksLikePob(text: string): boolean {
  const s = text.trim();
  if (pobSourceUrl(s)) return true;
  return s.length >= 200 && s.length <= 2_000_000 && /^[A-Za-z0-9_\-+/=]+$/.test(s);
}

export function pobSourceUrl(input: string): string | null {
  const s = input.trim();
  let m = /^https?:\/\/pastebin\.com\/(?:raw\/)?([A-Za-z0-9]+)\/?$/.exec(s);
  if (m) return `https://pastebin.com/raw/${m[1]}`;
  m = /^https?:\/\/pobb\.in\/([A-Za-z0-9_-]+)\/?(?:raw)?$/.exec(s);
  if (m) return `https://pobb.in/${m[1]}/raw`;
  return null;
}
