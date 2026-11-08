// Path of Building import: code (url-safe base64 of zlib-deflated XML) -> structured build.

import zlib from "node:zlib";
import type { PobBuild, PobGem, PobSkillGroup } from "../shared/types";

export function decodePobCode(code: string): string {
  const b64 = code.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!b64) throw new Error("código do PoB vazio");
  const buf = Buffer.from(b64, "base64");
  try {
    return zlib.inflateSync(buf).toString("utf8");
  } catch {
    try {
      return zlib.inflateRawSync(buf).toString("utf8");
    } catch {
      throw new Error("não é um código do PoB válido (falha ao descompactar)");
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

export function parsePobXml(xml: string): PobBuild {
  if (!/<PathOfBuilding/.test(xml)) throw new Error("não é uma exportação do Path of Building");

  const buildTag = /<Build\b([^>]*)>/.exec(xml);
  const b = buildTag ? attrs(buildTag[1]) : {};

  // --- skills: use the active skill set if the export has several
  let skillsXml = "";
  const skillsBlock = /<Skills\b([^>]*)>([\s\S]*?)<\/Skills>/.exec(xml);
  if (skillsBlock) {
    const active = attrs(skillsBlock[1]).activeSkillSet;
    const sets = [...skillsBlock[2].matchAll(/<SkillSet\b([^>]*)>([\s\S]*?)<\/SkillSet>/g)];
    if (sets.length) {
      const pick = sets.find((s) => attrs(s[1]).id === active) ?? sets[0];
      skillsXml = pick[2];
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

  // --- passive tree: active spec
  let treeNodes: number[] = [];
  const treeBlock = /<Tree\b([^>]*)>([\s\S]*?)<\/Tree>/.exec(xml);
  if (treeBlock) {
    const activeSpec = Number(attrs(treeBlock[1]).activeSpec) || 1;
    const specs = [...treeBlock[2].matchAll(/<Spec\b([^>]*?)(?:\/>|>)/g)];
    const spec = specs[activeSpec - 1] ?? specs[0];
    if (spec) {
      const nodes = attrs(spec[1]).nodes;
      if (nodes) treeNodes = nodes.split(",").map(Number).filter((n) => Number.isFinite(n));
    }
  }

  return {
    className: b.className ?? "",
    ascendClass: b.ascendClassName ?? "",
    level: Number(b.level) || 1,
    groups,
    treeNodes,
  };
}

export function importPob(code: string): PobBuild {
  return parsePobXml(decodePobCode(code));
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
