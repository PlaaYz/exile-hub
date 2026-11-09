// League challenges: the list comes from the project's GitHub (updated each league without a new
// app release; cached), the bundled copy is the fallback. Progress is ticked by the player and kept
// per patch in the user folder.
import { emptyProgress, parseChallengeList, setChallenge, type ChallengeList, type ChallengeProgress } from "../core/challenges";
import type { ChallengesView } from "../shared/types";
import type { Platform } from "./platform";

export const kChallengesUrl = "https://raw.githubusercontent.com/PlaaYz/exile-hub/main/data/challenges.json";
const kListFile = "challenges.json";
const kProgressFile = "challenges-progress.json";
const kListMaxAgeMs = 6 * 3600 * 1000;

export class ChallengeService {
  private list: ChallengeList | null = null;
  private loading: Promise<void> | null = null;
  private progress: Record<string, ChallengeProgress> = {};
  private error: string | null = null;

  constructor(private readonly p: Platform) {}

  private async loadList(): Promise<void> {
    const p = this.p;
    const fromText = (t: string | null) => {
      try {
        return t ? parseChallengeList(JSON.parse(t)) : null;
      } catch {
        return null;
      }
    };
    const age = await p.userFileAge(kListFile);
    let list = age !== null && Date.now() - age < kListMaxAgeMs ? fromText(await p.readUserFile(kListFile)) : null;
    if (!list) {
      try {
        const text = await p.fetchText(kChallengesUrl, 15_000);
        list = fromText(text);
        if (list) await p.writeUserFile(kListFile, text);
        this.error = list ? null : "lista baixada inválida";
      } catch (e) {
        this.error = `sem conexão com o GitHub (${e instanceof Error ? e.message : String(e)})`;
      }
    }
    list ??= fromText(await p.readUserFile(kListFile)) ?? fromText(await p.readData("challenges.json").catch(() => null));
    this.list = list;
    try {
      const saved = await p.readUserFile(kProgressFile);
      if (saved) this.progress = JSON.parse(saved) as Record<string, ChallengeProgress>;
    } catch {
      /* first use */
    }
  }

  private ensure(): Promise<void> {
    this.loading ??= this.loadList();
    return this.loading;
  }

  private view(): ChallengesView {
    const key = this.list?.patch ?? "";
    return { list: this.list, progress: this.progress[key] ?? emptyProgress(), error: this.error };
  }

  async get(): Promise<ChallengesView> {
    await this.ensure();
    return this.view();
  }

  /** Re-downloads the list (button in the panel). */
  async refresh(): Promise<ChallengesView> {
    await this.p.writeUserFile(kListFile, "").catch(() => {});
    this.loading = null;
    return this.get();
  }

  async set(id: string, done: boolean, part: number | null): Promise<ChallengesView> {
    await this.ensure();
    const list = this.list;
    if (!list) return this.view();
    const cur = this.progress[list.patch] ?? emptyProgress();
    this.progress = { ...this.progress, [list.patch]: setChallenge(list, cur, id, done, part ?? undefined) };
    await this.p.writeUserFile(kProgressFile, JSON.stringify(this.progress));
    return this.view();
  }
}
