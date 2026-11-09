import { describe, expect, it } from "vitest";
import { emptyProgress, isDone, orderChallenges, parseChallengeList, setChallenge } from "../src/core/challenges";

const raw = {
  league: "Test League",
  patch: "3.30",
  updated: "2026-11-13",
  rewards: [12, 24, 32, 36],
  challenges: [
    { id: "hard", name: "Kill Uber Bosses", difficulty: 5, category: "bosses", description: "x", tips: ["t"] },
    { id: "easy", name: "Finish the Campaign", difficulty: 1, category: "campanha", description: "x", tips: [] },
    { id: "mid", name: "Run Maps", difficulty: 3, category: "mapas", description: "x", tips: [], parts: ["a", "b", "c", "d"], need: 3 },
    { id: "mid2", name: "Craft Things", difficulty: 3, category: "crafting", description: "x", tips: [] },
    { id: "easy", name: "duplicate id", difficulty: 1 },
    { name: "no id" },
    { id: "big", name: "Clamped", difficulty: 99, parts: ["x"], need: 7 },
  ],
};

describe("challenges", () => {
  const list = parseChallengeList(raw)!;

  it("validates the downloaded list", () => {
    expect(list.challenges.map((c) => c.id)).toEqual(["hard", "easy", "mid", "mid2", "big"]);
    expect(list.challenges.find((c) => c.id === "big")).toMatchObject({ difficulty: 5, need: 1 });
    expect(parseChallengeList({ league: "x" })).toBeNull();
    expect(parseChallengeList("nope")).toBeNull();
  });

  it("orders what is left from easy to hard, closest to done first on ties", () => {
    let p = emptyProgress();
    p = setChallenge(list, p, "mid", true, 0);
    p = setChallenge(list, p, "mid", true, 1);
    const { todo, done } = orderChallenges(list, p);
    expect(todo.map((c) => c.id)).toEqual(["easy", "mid", "mid2", "hard", "big"]);
    expect(done).toEqual([]);
  });

  it("a challenge with parts is done when enough parts are ticked", () => {
    let p = emptyProgress();
    for (const i of [0, 1, 3]) p = setChallenge(list, p, "mid", true, i);
    expect(isDone(list.challenges.find((c) => c.id === "mid")!, p)).toBe(true);
    p = setChallenge(list, p, "easy", true);
    const { todo, done } = orderChallenges(list, p);
    expect(done.map((c) => c.id)).toEqual(["easy", "mid"]);
    expect(todo.map((c) => c.id)).toEqual(["mid2", "hard", "big"]);
  });

  it("ignores unknown ids and parts out of range", () => {
    const p = emptyProgress();
    expect(setChallenge(list, p, "nope", true)).toBe(p);
    expect(setChallenge(list, p, "mid", true, 9)).toBe(p);
    expect(setChallenge(list, p, "easy", true, 0)).toBe(p); // no parts
  });
});
