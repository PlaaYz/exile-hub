import { afterEach, describe, expect, it } from "vitest";
import { cleanConfigPatch } from "../src/app/ipcClean";
import { mapModLabel, mapSearch, MAP_MODS } from "../src/core/searchRegex";
import { lang, resolveLang, setLang, tr } from "../src/shared/i18n";

describe("UI language", () => {
  afterEach(() => setLang("pt"));

  it("starts in Portuguese and switches both ways", () => {
    expect(lang()).toBe("pt");
    expect(tr("Mapas", "Maps")).toBe("Mapas");
    setLang("en");
    expect(tr("Mapas", "Maps")).toBe("Maps");
  });

  it("a fixed choice wins over the system language", () => {
    expect(resolveLang("en")).toBe("en");
    expect(resolveLang("pt")).toBe("pt");
    expect(["pt", "en"]).toContain(resolveLang("auto"));
  });

  it("the setting only accepts auto / pt / en", () => {
    expect(cleanConfigPatch({ language: "en" })).toEqual({ language: "en" });
    expect(cleanConfigPatch({ language: "auto" })).toEqual({ language: "auto" });
    expect(cleanConfigPatch({ language: "fr" })).toEqual({});
  });

  it("map mods read in English from the game's own wording", () => {
    const reflect = MAP_MODS.find((m) => m.id === "phys-reflect")!;
    expect(mapModLabel(reflect)).toBe(reflect.label);
    setLang("en");
    expect(mapModLabel(reflect)).toBe("Monsters reflect #% of physical damage");
    expect(mapSearch(["phys-reflect"], 70).parts.join(" | ")).toMatch(/^without "Monsters reflect #% of physical damage".*item quantity >= 70%$/);
  });
});
