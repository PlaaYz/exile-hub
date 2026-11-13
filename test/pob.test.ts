import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import {
  applyGemLevels,
  decodePobCode,
  gemLevelTable,
  importPob,
  looksLikePob,
  parsePobXml,
  pobSourceUrl,
} from "../src/core/pob";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" className="Witch" ascendClassName="Elementalist" mainSocketGroup="1">
  </Build>
  <Skills activeSkillSet="2" sortGemsByDPSField="CombinedDPS">
    <SkillSet id="1">
      <Skill label="Old" enabled="true"><Gem nameSpec="Fireball" level="1" quality="0" enabled="true" gemId="Metadata/Items/Gems/SkillGemFireball" skillId="Fireball"/></Skill>
    </SkillSet>
    <SkillSet id="2">
      <Skill label="Main" slot="Body Armour" enabled="true">
        <Gem nameSpec="Arc" level="20" quality="20" enabled="true" gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc"/>
        <Gem nameSpec="Added Lightning Damage" level="20" quality="0" enabled="true" gemId="Metadata/Items/Gems/SupportGemAddedLightningDamage" skillId="SupportAddedLightningDamage"/>
        <Gem nameSpec="Spell Echo &amp; Co" level="1" quality="0" enabled="false" gemId="Metadata/Items/Gems/SupportGemSpellEcho" skillId="SupportSpellEcho"/>
      </Skill>
      <Skill enabled="false"><Gem nameSpec="Frostbolt" level="5" quality="0" enabled="true" skillId="Frostbolt"/></Skill>
    </SkillSet>
  </Skills>
  <Tree activeSpec="2">
    <Spec title="a" nodes="1,2,3"/>
    <Spec title="b" treeVersion="3_26" nodes="10,20,30,40"></Spec>
  </Tree>
</PathOfBuilding>`;

describe("PoB import", () => {
  it("parses build info, active skill set and groups", () => {
    const b = parsePobXml(XML);
    expect(b).toMatchObject({ className: "Witch", ascendClass: "Elementalist", level: 90 });
    expect(b.groups.map((g) => g.label)).toEqual(["Main", "Frostbolt"]);
    const main = b.groups[0];
    expect(main.slot).toBe("Body Armour");
    expect(main.gems.map((g) => g.name)).toEqual(["Arc", "Added Lightning Damage", "Spell Echo & Co"]);
    expect(main.gems.map((g) => g.support)).toEqual([false, true, true]);
    expect(main.gems[2].enabled).toBe(false);
    expect(b.groups[1].enabled).toBe(false);
  });

  it("uses the active tree spec", () => {
    expect(parsePobXml(XML).treeNodes).toEqual([10, 20, 30, 40]);
  });

  it("round-trips through a real PoB-style code (url-safe base64 + zlib)", () => {
    const code = zlib
      .deflateSync(Buffer.from(XML))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(decodePobCode(code)).toBe(XML);
    expect(importPob(`  ${code}\n`).groups).toHaveLength(2);
  });

  it("recognises clipboard text worth importing", () => {
    expect(looksLikePob("https://pobb.in/AbC_12")).toBe(true);
    expect(looksLikePob("https://pastebin.com/xyz123")).toBe(true);
    expect(looksLikePob("eNrt" + "A".repeat(400))).toBe(true); // real codes are thousands of chars
    expect(looksLikePob("short")).toBe(false);
    expect(looksLikePob("a normal sentence ".repeat(30))).toBe(false);
    expect(looksLikePob("https://example.com/a")).toBe(false);
  });

  it("rejects junk", () => {
    expect(() => importPob("")).toThrow();
    expect(() => importPob("not a code!!")).toThrow();
    expect(() => parsePobXml("<foo/>")).toThrow();
  });

  it("fills required levels from the gem table", () => {
    const table = gemLevelTable({
      a: { name: "Arc", required_level: 12 },
      b: { name: "Added Lightning Damage Support", required_level: 8 },
    });
    const b = applyGemLevels(parsePobXml(XML), table);
    expect(b.groups[0].gems.map((g) => g.requiredLevel)).toEqual([12, 8, null]);
  });

  it("maps pastebin / pobb.in links to raw urls", () => {
    expect(pobSourceUrl("https://pastebin.com/AbC123")).toBe("https://pastebin.com/raw/AbC123");
    expect(pobSourceUrl("https://pobb.in/xYz_9")).toBe("https://pobb.in/xYz_9/raw");
    expect(pobSourceUrl("eNrtXetz")).toBeNull();
  });
});

describe("build stages", () => {
  const xml = `<PathOfBuilding><Build className="Witch" level="90"/>
<Skills activeSkillSet="2">
  <SkillSet id="1" title="Leveling"><Skill label="L"><Gem nameSpec="Freezing Pulse" level="1"/></Skill></SkillSet>
  <SkillSet id="2" title="Endgame"><Skill label="E"><Gem nameSpec="Vortex" level="20"/></Skill></SkillSet>
</Skills>
<Tree activeSpec="2"><Spec title="Leveling" nodes="1,2"/><Spec title="Endgame" nodes="1,2,3,4"/></Tree>
<Items activeItemSet="1">
  <Item id="1">Rarity: RARE
Old Ring
Iron Ring
Implicits: 0
+10 to maximum Life</Item>
  <Item id="2">Rarity: RARE
New Ring
Iron Ring
Implicits: 0
+20 to maximum Life</Item>
  <ItemSet id="1" title="Endgame"><Slot name="Ring 1" itemId="2"/></ItemSet>
  <ItemSet id="2" title="Leveling"><Slot name="Ring 1" itemId="1"/></ItemSet>
</Items></PathOfBuilding>`;

  it("lists the trees as stages and opens PoB's active one", () => {
    const b = parsePobXml(xml);
    expect(b.stages).toEqual(["Leveling", "Endgame"]);
    expect(b.stage).toBe(1);
    expect(b.treeNodes).toEqual([1, 2, 3, 4]);
  });

  it("a picked stage takes the skill and item sets of the same title", async () => {
    const { parsePobEquipped } = await import("../src/core/itemCompare");
    const b = parsePobXml(xml, 0);
    expect(b.treeNodes).toEqual([1, 2]);
    expect(b.groups[0].gems[0].name).toBe("Freezing Pulse");
    expect(parsePobEquipped(xml, 0)[0].item.name).toBe("Old Ring");
    expect(parsePobEquipped(xml, 1)[0].item.name).toBe("New Ring");
  });
});

describe("gem levels", () => {
  it("support gems without \"Support\" and transfigured gems use the gem data's names", () => {
    const table = gemLevelTable({ a: { name: "Combustion Support", required_level: 38 }, b: { name: "Pyroclast Mine", required_level: 28 } });
    const build = { className: "", ascendClass: "", level: 1, treeNodes: [], stages: [], stage: 0, groups: [{ label: "x", slot: null, enabled: true, gems: ["Combustion", "Pyroclast Mine of Sabotage", "Herald of the Hive"].map((name) => ({ name, level: 1, quality: 0, enabled: true, support: false, requiredLevel: null })) }] };
    expect(applyGemLevels(build, table).groups[0].gems.map((g) => g.requiredLevel)).toEqual([38, 28, null]);
  });
});
