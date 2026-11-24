// Prices, all from poe.ninja: the item the price key copied, the farm tables and the league list.
// GGG's trade site API is not used: it is not part of their documented API (removed by the owner, 2026-11-23).
import type { DiagKind } from "../core/diag";
import { farmItemNames } from "../core/farm";
import type { EquippedItem } from "../core/itemCompare";
import { NinjaClient, defaultLeague, fetchLeagues, isChallengeLeague, isSuspect, priceByName } from "../core/ninja";
import { PriceChecker } from "../core/pricecheck";
import { FARM_BOSSES } from "../shared/farmData";
import type { FarmPricesResult } from "../shared/ipc";
import type { AppConfig, PriceRecent, PriceView } from "../shared/types";
import { kLeagueRefreshMs, kLeagueWaitMs } from "./constants";
import type { Platform } from "./platform";
import { tr } from "../shared/i18n";

export interface PriceContext {
  config(): AppConfig;
  broadcast(): void;
  addDiag(kind: DiagKind, text: string): void;
  /** what the player wears (compare with my item) */
  equipped(): readonly EquippedItem[];
}

/** Items kept in the "recent checks" list. */
const kRecentChecks = 10;

export class PriceService {
  readonly ninja: NinjaClient;
  private readonly checker: PriceChecker;
  leagues: string[] = [];
  private lastPriceDiag = "";
  /** items priced since the app started (session summaries): one entry per check */
  readonly history: { ts: number; name: string; chaos: number | null }[] = [];
  /** last checked items, newest first (with their text, to check them again) */
  private recentChecks: (PriceRecent & { text: string; seq: number })[] = [];
  private recentId = 0;
  /** bumps when the league changes: the farm tab asks for prices again */
  farmPricesVersion = 0;
  /** the last farm prices (session earnings use them without asking the network again) */
  lastFarmPrices: FarmPricesResult | null = null;
  lastFarmPricesAt = 0;

  constructor(
    private readonly platform: Platform,
    private readonly ctx: PriceContext,
  ) {
    this.ninja = new NinjaClient(platform.fetch, platform.userAgent);
    this.checker = new PriceChecker({
      ninja: this.ninja,
      onUpdate: (v) => this.onPrice(v),
      equipped: () => this.ctx.equipped(),
    });
  }

  get view(): PriceView | null {
    return this.checker.view;
  }

  /**
   * League used for prices: the configured one while it still exists (a league chosen by hand ends
   * with its season), else the current challenge league.
   */
  league(): string | null {
    const chosen = this.ctx.config().league;
    if (chosen && (!this.leagues.length || this.leagues.includes(chosen))) return chosen;
    return defaultLeague(this.leagues);
  }

  private leagueTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * The league list, re-read every hour: a new league (e.g. 3.30 on launch day) is picked up while
   * the app sits in the tray, without a restart.
   */
  async loadLeagues(): Promise<void> {
    this.leagueTimer ??= setInterval(() => void this.loadLeagues(), kLeagueRefreshMs);
    const before = this.league();
    try {
      this.leagues = await fetchLeagues(this.platform.fetch, this.platform.userAgent);
      const after = this.league();
      if (before && after && before !== after) this.ctx.addDiag("preço", `liga dos preços agora é ${after} (era ${before})`);
      if (after && after !== before) {
        // first load (or a new league): farm prices asked before this failed with "league not loaded";
        // fetch them now and make an open Farm tab ask again
        this.farmPricesVersion++;
        void this.farmPrices().then(() => this.ctx.broadcast());
      }
      this.ctx.broadcast();
      if (!this.leagues.some(isChallengeLeague)) this.retryLeagues();
    } catch (e) {
      console.error("could not load leagues", e);
      this.retryLeagues();
    }
  }

  private leagueRetry: ReturnType<typeof setTimeout> | null = null;

  private retryLeagues(): void {
    if (this.leagueRetry) return;
    this.leagueRetry = setTimeout(() => {
      this.leagueRetry = null;
      void this.loadLeagues();
    }, kLeagueWaitMs);
  }

  /** Prices the item text the price key copied; false when it is not an item (or no league is known yet). */
  check(text: string): boolean {
    const league = this.league();
    if (!league) {
      this.ctx.addDiag("preço", "item copiado, mas a liga ainda não carregou");
      return false;
    }
    if (!this.checker.check(text, league)) return false;
    this.remember(text);
    const it = this.checker.view?.item;
    this.ctx.addDiag("clipboard", `item copiado: ${it ? `${it.name || it.baseType} (${it.rarity}, ${it.itemClass})` : "?"}`);
    return true;
  }

  private onPrice(v: PriceView): void {
    const key = `${v.seq}:${v.ninjaStatus}`;
    if (v.ninjaStatus !== "loading" && key !== this.lastPriceDiag) {
      this.lastPriceDiag = key;
      const price = v.ninja
        ? `poe.ninja ${Math.round(v.ninja.chaos)}c`
        : `poe.ninja ${v.ninjaStatus === "error" ? `erro (${v.ninjaError})` : "sem referência"}`;
      this.ctx.addDiag("preço", `${v.item.name || v.item.baseType}: ${price}`);
      const stack = v.item.stackSize && v.item.stackSize > 1 ? v.item.stackSize : 1;
      const chaos = v.ninja ? v.ninja.chaos * stack : null;
      this.history.push({ ts: v.at, name: v.item.name || v.item.baseType, chaos });
      const r = this.recentChecks.find((x) => x.seq === v.seq);
      if (r) r.chaos = chaos;
      if (this.history.length > 500) this.history.splice(0, this.history.length - 500);
    }
    this.ctx.broadcast();
  }

  /** Puts the item just checked on top of the recent list (the same text moves up instead of repeating). */
  private remember(text: string): void {
    const v = this.checker.view;
    if (!v) return;
    this.recentChecks = this.recentChecks.filter((r) => r.text !== text);
    this.recentChecks.unshift({ id: ++this.recentId, text, seq: v.seq, name: v.item.name || v.item.baseType, rarity: v.item.rarity, at: v.at, chaos: null });
    this.recentChecks.length = Math.min(this.recentChecks.length, kRecentChecks);
  }

  get recent(): PriceRecent[] {
    return this.recentChecks.map(({ id, name, rarity, at, chaos }) => ({ id, name, rarity, at, chaos }));
  }

  /** Checks a recent item again (fresh prices) without copying it in the game. */
  recheck(id: number): void {
    const r = this.recentChecks.find((x) => x.id === id);
    const league = this.league();
    if (!r || !league || !this.checker.check(r.text, league)) return;
    r.seq = this.checker.view!.seq;
    r.at = this.checker.view!.at;
    r.chaos = null;
    this.recentChecks = [r, ...this.recentChecks.filter((x) => x !== r)];
    this.ctx.broadcast();
  }

  /** Live prices for every item in the farm tables (poe.ninja, cached 30 min). */
  async farmPrices(): Promise<FarmPricesResult> {
    const league = this.league();
    if (!league) return { league: null, chaosPerDivine: null, prices: {}, suspect: [], error: tr("liga ainda não carregada", "league not loaded yet") };
    try {
      const [found, rates] = await Promise.all([
        priceByName(this.ninja, league, farmItemNames(FARM_BOSSES)),
        this.ninja.currencyRates(league).catch(() => null),
      ]);
      const cpd = rates?.get("divine") ?? null;
      const prices: FarmPricesResult["prices"] = {};
      const suspect: string[] = [];
      for (const [name, p] of found) {
        if (isSuspect(p, cpd)) suspect.push(name);
        else prices[name] = { chaos: p.chaos, lowConfidence: p.lowConfidence, variants: p.variants };
      }
      this.lastFarmPrices = { league, chaosPerDivine: cpd, prices, suspect, error: null };
      this.lastFarmPricesAt = Date.now();
      return this.lastFarmPrices;
    } catch (e) {
      return { league, chaosPerDivine: null, prices: {}, suspect: [], error: (e as Error).message };
    }
  }
}
