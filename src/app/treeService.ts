// The imported build's passive tree as a guide: GGG's tree data (cached) with the build's nodes.
import { compareTree, kTreeFormat, slimTree, treeLayout, type PassiveTree } from "../core/passives";
import type { AppState, PobBuild, TreeLayout } from "../shared/types";
import { kTreeMaxAgeMs, kTreeUrl } from "./constants";
import type { Platform } from "./platform";

export class TreeService {
  private loading: Promise<PassiveTree | null> | null = null;
  private data: PassiveTree | null = null;
  private layoutCache: TreeLayout | null = null;

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
        const cached = text ? (JSON.parse(text) as PassiveTree) : null;
        if (cached?.format === kTreeFormat) return cached; // older caches have no node positions
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

  /** Geometry for the tree map (sent once to a window, not with every state). */
  async layout(): Promise<TreeLayout | null> {
    const tree = await this.load();
    if (!tree || tree.format !== kTreeFormat) return null;
    this.layoutCache ??= treeLayout(tree);
    return this.layoutCache;
  }

  /** The build's tree as a guide: nothing is marked as taken (the character's own tree is not followed). */
  state(build: PobBuild | null): AppState["tree"] {
    if (!build) return null;
    if (!this.data) {
      void this.load();
      return { status: "loading", progress: null };
    }
    return { status: "ok", progress: compareTree(this.data, build, new Map()) };
  }
}
