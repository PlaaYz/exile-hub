// Passive tree progress: GGG's tree data (cached) compared with the build and the log.
import { compareTree, pointBudget, pointsIn, slimTree, type PassiveTracker, type PassiveTree } from "../core/passives";
import type { Session } from "../core/session";
import type { AppState, PobBuild } from "../shared/types";
import { kTreeMaxAgeMs, kTreeUrl } from "./constants";
import type { Platform } from "./platform";

export class TreeService {
  private loading: Promise<PassiveTree | null> | null = null;
  private data: PassiveTree | null = null;

  constructor(
    private readonly platform: Platform,
    private readonly broadcast: () => void,
  ) {}

  /** GGG's skilltree-export (character tree), slimmed and cached for a week. */
  private load(): Promise<PassiveTree | null> {
    if (this.loading) return this.loading;
    const file = "passive-tree.json";
    const p = this.platform;
    this.loading = (async () => {
      const age = await p.userFileAge(file);
      if (age !== null && Date.now() - age < kTreeMaxAgeMs) {
        const text = await p.readUserFile(file);
        if (text) return JSON.parse(text) as PassiveTree;
      }
      try {
        const res = await p.fetch(kTreeUrl, { headers: { "User-Agent": p.userAgent } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const tree = slimTree((await res.json()) as Parameters<typeof slimTree>[0], "latest");
        await p.writeUserFile(file, JSON.stringify(tree));
        return tree;
      } catch (e) {
        console.error("could not load passive tree", e);
        const text = await p.readUserFile(file); // stale cache is fine: node ids rarely change
        if (text) return JSON.parse(text) as PassiveTree;
        this.loading = null; // try again later
        return null;
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
