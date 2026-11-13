import { describe, expect, it } from "vitest";
import { ModTranslator } from "../src/core/modPt";

const list = (entries: [string, string][]) => ({ result: [{ id: "explicit", entries: entries.map(([id, text]) => ({ id, text, type: "explicit" })) }] });
const en = list([
  ["a", "+# to maximum Life"],
  ["b", "#% chance to gain Onslaught for 4 seconds on Kill"],
  ["c", "#% increased Armour (Local)"],
  ["d", "Adds # to # Physical Damage"],
]);
const pt = list([
  ["a", "+# de Vida máxima"],
  ["b", "#% de chance de ganhar Agressividade por 4 segundos ao Matar"],
  ["c", "Armadura aumentada em #% (Local)"],
  ["d", "Adiciona # a # de Dano Físico"],
]);

describe("mod lines in Portuguese", () => {
  const t = new ModTranslator(en, pt);
  it("puts the line's numbers in GGG's Portuguese text", () => {
    expect(t.translate("+116 to maximum Life")).toBe("+116 de Vida máxima");
    expect(t.translate("72% increased Armour")).toBe("Armadura aumentada em 72%");
    expect(t.translate("Adds 10 to 20 Physical Damage")).toBe("Adiciona 10 a 20 de Dano Físico");
  });
  it("keeps buff names in English and numbers written in the stat text", () => {
    expect(t.translate("14% chance to gain Onslaught for 4 seconds on Kill")).toBe("14% de chance de ganhar Onslaught por 4 segundos ao Matar");
  });
  it("leaves unknown lines as they are", () => {
    expect(t.translate("Fractured Item")).toBe("Fractured Item");
  });
});
