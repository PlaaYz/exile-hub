// Runs Path of Building's real engine through our driver when PoB is installed on this machine
// (skipped elsewhere). Guards the parts tests with fakes cannot: PoB's API names, gem ids, output.
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { availableSupports, type GemInfo, type QuestInfo } from "../src/core/gemAvailability";
import { createPobLua, findPob } from "../src/main/luaHost";
import type { SuggestResult } from "../src/shared/types";

const root = path.resolve(__dirname, "..");
const pob = findPob();
const cwd = process.cwd();
afterAll(() => process.chdir(cwd));

function arcBuildXml(): string {
  // a minimal PoB export: Witch with Arc in the main group, nothing else
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
<Build level="90" className="Witch" ascendClassName="Elementalist" mainSocketGroup="1" targetVersion="3_0"></Build>
<Skills activeSkillSet="1"><SkillSet id="1">
<Skill label="Arc" slot="Body Armour" enabled="true" mainActiveSkill="1">
<Gem nameSpec="Arc" skillId="Arc" gemId="Metadata/Items/Gems/SkillGemArc" level="20" quality="0" enabled="true"/>
</Skill></SkillSet></Skills>
<Tree activeSpec="1"><Spec treeVersion="3_26" classId="3" ascendClassId="1" nodes=""></Spec></Tree>
<Items></Items><Config></Config>
</PathOfBuilding>`;
  // round-trip through the PoB code format like a real import would
  const code = zlib.deflateSync(Buffer.from(xml)).toString("base64");
  return zlib.inflateSync(Buffer.from(code, "base64")).toString("utf8");
}

describe.skipIf(!pob)("Path of Building engine (installed PoB)", () => {
  const gems: Record<string, GemInfo> = JSON.parse(fs.readFileSync(path.join(root, "data/json/gems.json"), "utf8"));
  const quests: Record<string, QuestInfo> = JSON.parse(fs.readFileSync(path.join(root, "data/json/quests.json"), "utf8"));
  let engine: ReturnType<typeof createPobLua>;

  it("boots headless with the bundled wrapper and our driver", () => {
    engine = createPobLua(pob!.dir, path.join(root, "vendor/pob/HeadlessWrapper.lua"), path.join(root, "vendor/pob/exilehub.lua"));
    expect(engine).toBeTruthy();
  }, 60_000);

  it("ranks supports a level 24 Witch can get by act 3 for Arc, with mana numbers", () => {
    const candidates = availableSupports(gems, quests, "Witch", 3, 24).map((g) => ({ id: g.id, name: g.name }));
    const r = JSON.parse(engine.suggest({ xml: arcBuildXml(), xmlKey: "t1", level: 24, candidates, maxSupports: 3 })) as SuggestResult;
    expect(r.ok, r.error).toBe(true);
    expect(r.skill).toBe("Arc");
    expect(r.base!.dps).toBeGreaterThan(0);
    expect(r.base!.cost).toBeGreaterThan(0);
    const names = r.singles!.map((s) => s.name);
    expect(names).toContain("Arcane Surge");
    for (const s of r.singles!) {
      expect(s.gain).toBeGreaterThan(0);
      expect(candidates.some((c) => c.id === s.id)).toBe(true); // answers with our ids
    }
    // sorted best first, and each extra link adds damage
    for (let i = 1; i < r.singles!.length; i++) expect(r.singles![i - 1].dps).toBeGreaterThanOrEqual(r.singles![i].dps);
    for (let i = 1; i < r.combo!.length; i++) expect(r.combo![i].dps).toBeGreaterThan(r.combo![i - 1].dps);
  }, 60_000);

  it("reuses the loaded build without the xml and explains a too-low level", () => {
    const again = JSON.parse(engine.suggest({ xmlKey: "t1", level: 8, candidates: [], maxSupports: 3 })) as SuggestResult;
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/Arc precisa do nível 12/);
    expect(again.soft).toBe(true);
    const other = JSON.parse(engine.suggest({ xmlKey: "another", level: 20, candidates: [], maxSupports: 3 })) as SuggestResult;
    expect(other).toMatchObject({ ok: false, error: "need-xml" });
  }, 60_000);
});
