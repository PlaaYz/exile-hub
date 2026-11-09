import { describe, expect, it } from "vitest";
import { cleanChatCommands, expandCommand, isValidKey, isValidText, normaliseKey } from "../src/core/chatCommands";
import { parseLine } from "../src/core/clientLog";

describe("chat commands", () => {
  it("accepts F-keys and modified keys, not F9/F10 or bare letters", () => {
    expect(isValidKey("F5")).toBe(true);
    expect(isValidKey("ctrl+h")).toBe(true);
    expect(isValidKey("Shift+Ctrl+1")).toBe(true);
    expect(isValidKey("F9")).toBe(false);
    expect(isValidKey("F10")).toBe(false);
    expect(isValidKey("H")).toBe(false);
    expect(isValidKey("F13")).toBe(false);
    expect(normaliseKey("shift+ctrl+h")).toBe("Ctrl+Shift+H");
  });

  it("only chat commands and whispers, one line", () => {
    expect(isValidText("/hideout")).toBe(true);
    expect(isValidText("@{last_whisper} ty")).toBe(true);
    expect(isValidText("hello")).toBe(false);
    expect(isValidText("/a\n/b")).toBe(false);
    expect(isValidText("/")).toBe(false);
  });

  it("cleans renderer input: one entry per key", () => {
    expect(
      cleanChatCommands([
        { key: "F5", text: "/hideout" },
        { key: "f5", text: "/exit" },
        { key: "F9", text: "/hideout" },
        { key: "Ctrl+I", text: " /invite {last_whisper} " },
        { key: 3, text: "/x" },
      ]),
    ).toEqual([
      { key: "F5", text: "/hideout" },
      { key: "Ctrl+I", text: "/invite {last_whisper}" },
    ]);
    expect(cleanChatCommands("nope")).toBeNull();
  });

  it("fills in the last whisperer", () => {
    expect(expandCommand("/hideout", null)).toBe("/hideout");
    expect(expandCommand("/invite {last_whisper}", "SomeExile")).toBe("/invite SomeExile");
    expect(expandCommand("/invite {last_whisper}", null)).toBeNull();
  });

  it("parses whispers from Client.txt, with or without a guild tag", () => {
    expect(parseLine("2026/09/05 19:26:31 7659546 cffb065b [INFO Client 16964] @From Buyer_One: Hi, I would like to buy")).toMatchObject({
      type: "whisper",
      from: "Buyer_One",
    });
    expect(parseLine("2026/09/05 19:26:31 7659546 cffb065b [INFO Client 16964] @From <GLD> Buyer: wtb")).toMatchObject({
      type: "whisper",
      from: "Buyer",
    });
    // whispers you sent are not "last whisperer"
    expect(parseLine("2026/09/05 19:26:31 7659546 cffb065b [INFO Client 16964] @To Buyer: sold")).toBeNull();
  });
});
