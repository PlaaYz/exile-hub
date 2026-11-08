import { describe, expect, it } from "vitest";
import { baseClass } from "../src/core/classes";

describe("baseClass", () => {
  it("maps ascendancies to their base class", () => {
    expect(baseClass("Slayer")).toBe("Duelist");
    expect(baseClass("Occultist")).toBe("Witch");
    expect(baseClass("Hierophant")).toBe("Templar");
    expect(baseClass("Assassin")).toBe("Shadow");
    expect(baseClass("Ascendant")).toBe("Scion");
  });
  it("keeps base classes and rejects unknown names", () => {
    expect(baseClass("Duelist")).toBe("Duelist");
    expect(baseClass("Nobody")).toBeNull();
    expect(baseClass(null)).toBeNull();
  });
});
