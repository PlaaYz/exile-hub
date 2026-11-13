import { describe, expect, it } from "vitest";
import { loadVisible } from "../src/renderer/Dashboard";

const store = (o: Record<string, string>) => (k: string) => o[k] ?? null;

describe("dashboard tabs", () => {
  it("keeps hidden tabs hidden and shows a tab added by an update once", () => {
    const saved = JSON.stringify({ visible: ["maps", "farm"], known: ["campaign", "maps", "farm", "price"] });
    const v = loadVisible(store({ "exile-hub.panels": saved }));
    expect(v.slice(0, 2)).toEqual(["maps", "farm"]);
    expect(v).not.toContain("campaign");
    expect(v).not.toContain("price");
    expect(v).toContain("gear"); // new since the save
  });

  it("takes the choice saved by older versions", () => {
    expect(loadVisible(store({ "exile-hub.visiblePanels.v10": JSON.stringify(["maps"]) }))).toEqual(["maps"]);
  });
});
