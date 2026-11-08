import { describe, expect, it } from "vitest";
import { parseLine } from "../src/core/clientLog";

describe("parseLine", () => {
  it("parses area generation with id and level", () => {
    const e = parseLine(
      '2026/11/08 12:00:01 123456789 abc [DEBUG Client 1234] Generating level 1 area "1_1_1" with seed 3569282693',
    );
    expect(e).toMatchObject({ type: "area", areaId: "1_1_1", areaLevel: 1, seed: 3569282693 });
    expect(e && "ts" in e && e.ts).toBe(new Date(2026, 10, 8, 12, 0, 1).getTime());
  });

  it("parses 'You have entered'", () => {
    const e = parseLine("2026/11/08 12:00:02 1 a [INFO Client 1234] : You have entered The Coast.");
    expect(e).toMatchObject({ type: "enter", name: "The Coast" });
  });

  it("parses level up with class and CRLF endings", () => {
    const e = parseLine("2026/11/08 12:05:00 1 a [INFO Client 1234] : Foo (Witch) is now level 12\r");
    expect(e).toMatchObject({ type: "levelup", character: "Foo", className: "Witch", level: 12 });
  });

  it("parses death", () => {
    const e = parseLine("2026/11/08 12:06:00 1 a [INFO Client 1234] : Foo has been slain.");
    expect(e).toMatchObject({ type: "death", character: "Foo" });
  });

  it("ignores chat lines that try to spoof events", () => {
    expect(
      parseLine("2026/11/08 12:00:00 1 a [INFO Client 1234] #Troll: x (Witch) is now level 100"),
    ).toBeNull();
    expect(
      parseLine('2026/11/08 12:00:00 1 a [INFO Client 1234] @From Troll: Generating level 1 area "1_1_1" with seed 1'),
    ).toBeNull();
  });

  it("parses window focus changes", () => {
    expect(parseLine("2026/09/21 17:51:49 23448421 54ee9d8c [INFO Client 7200] [WINDOW] Gained focus")).toMatchObject({
      type: "focus",
      focused: true,
    });
    expect(parseLine("2026/09/21 17:51:49 1 a [INFO Client 7200] [WINDOW] Lost focus\r")).toMatchObject({ focused: false });
    expect(parseLine("2026/09/21 17:51:49 1 a [INFO Client 7200] #Troll: [WINDOW] Lost focus")).toBeNull();
    expect(parseLine("2026/09/21 17:55:33 23672515 f9532a48 [INFO Client 7200] Closing game gracefully")).toMatchObject({
      type: "focus",
      focused: false,
    });
  });

  it("returns null for noise and empty lines", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("2026/11/08 12:00:00 1 a [INFO Client 1234] Connected to foo in 30ms.")).toBeNull();
  });
});
