// Passive tree progress: GGG's tree data (cached) compared with the build and the log.
import fs from "node:fs";
import { compareTree, pointBudget, pointsIn, slimTree, type PassiveTracker, type PassiveTree } from "../core/passives";
import type { Session } from "../core/session";
import type { AppState, PobBuild } from "../shared/types";
import { httpFetch, kTreeMaxAgeMs, kTreeUrl, kUserAgent, readJson, userFile } from "./env";

export class TreeService {
  private loading: Promise<PassiveTree | null> | null = null;
  private data: PassiveTree | null = null;

  constructor(private readonly broadcast: () => void) {}

  /** GGG's skilltree-export (character tree), slimmed and cached in userData for a week. */
  private load(): Promise<PassiveTree | null> {
    if (this.loading) return this.loading;
    const file = userFile("passive-tree.json");
    this.loading = (async () => {
      try {
        if (Date.now() - fs.statSync(file).mtimeMs < kTreeMaxAgeMs) return readJson<PassiveTree>(file);
      } catch {
        /* no cache */
      }
      try {
        const res = await httpFetch(kTreeUrl, { headers: { "User-Agent": kUserAgent } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const tree = slimTree((await res.json()) as Parameters<typeof slimTree>[0], "latest");
        fs.writeFileSync(file, JSON.stringify(tree));
        return tree;
      } catch (e) {
        console.error("could not load passive tree", e);
        try {
          return readJson<PassiveTree>(file); // stale cache is fine: node ids rarely change
        } catch {
          this.loading = null; // try again later
          return null;
        }
      }
    })();
    void this.loading.then((t) => {
      this.data = t;
      this.broadcast();
    });
    return this.loading;
  }

  state(build: PobBuild | null, session: Session, passives: PassiveTracker): AppState["tree"] {
    const name = session.characterName;
    if (!build) return null;
    if (!this.data) {
      void this.load();
      return { status: "loading", character: name, level: session.characterLevel, pointsSeen: 0, budget: 0, progress: null };
    }
    if (!name) return { status: "no-character", character: null, level: null, pointsSeen: 0, budget: 0, progress: null };
    const allocated = passives.allocated(name);
    const level = session.characterLevel ?? 1;
    const pointsSeen = pointsIn(allocated);
    const budget = pointBudget(level);
    return {
      status: pointsSeen > budget ? "inconsistent" : "ok",
      character: name,
      level,
      pointsSeen,
      budget,
      progress: compareTree(this.data, build, allocated),
    };
  }
}
