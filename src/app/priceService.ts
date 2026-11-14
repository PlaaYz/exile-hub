// Prices: the clipboard watcher (items -> price check, PoB codes -> build import), leagues,
// poe.ninja, the trade site (item listings, map searches) and the trade stat list.
import type { DiagKind } from "../core/diag";
import { farmItemNames } from "../core/farm";
import { isSuspect, needsTradePrice, tradePriceByName, type TradeNamePrice } from "../core/farmTrade";
import type { EquippedItem } from "../core/itemCompare";
import { mapModStatIds, mapTradeQuery, tradeSearchUrl, type MapTradeOptions } from "../core/mapTrade";
import { NinjaClient, priceByName } from "../core/ninja";
import { ModTranslator } from "../core/modPt";
import { looksLikePob } from "../core/pob";
import { PriceChecker } from "../core/pricecheck";
import { StatIndex, type TradeStatsData } from "../core/stats";
import {
  TradeClient,
  defaultLeague,
  isChallengeLeague,
  fetchItemsData,
  fetchLeagues,
  fetchStatic,
  fetchStats,
  itemQueryKeys,
  staticIds,
  type ItemQueryKey,
  type StaticIds,
} from "../core/trade";
import { FARM_BOSSES } from "../shared/farmData";
import type { FarmPricesResult } from "../shared/ipc";
import type { AppConfig, PriceRecent, PriceSearchPatch, PriceView } from "../shared/types";
import { kClipboardPollMs, kLeagueRefreshMs, kLeagueWaitMs, kStatsMaxAgeMs, kTradeSite } from "./constants";
import type { Platform } from "./platform";
import { tr } from "../shared/i18n";

export interface PriceContext {
  config(): AppConfig;
  broadcast(): void;
  addDiag(kind: DiagKind, text: string): void;
  /** clipboard text that looks like a Path of Building code or link */
  onPobText(text: string): void;
  /** what the imported PoB build wears (compare with my item) */
  equipped(): readonly EquippedItem[];
  /** item text copied with Ctrl+C (not the price key): true = taken by the equipment tab (no price check) */
  gearItem(text: string): boolean;
}

/** Items kept in the "recent checks" list. */
const kRecentChecks = 10;
/** Farm items priced on the trade site are looked up again after this long. */
const kFarmTradeMaxAgeMs = 6 * 3600 * 1000;
/**
 * Pause between farm lookups. GGG allows 600 trade searches per 6 hours per IP (seen 2026-11-14,
 * besides 30 per 5 min): one a minute at most, and none once half of any limit is used, so the
 * player's own price checks always have room.
 */
const kFarmTradeGapMs = 60_000;
const kFarmTradeMaxUsage = 0.5;
/**
 * After a round of farm lookups stops on errors (rate limit, network), no new round for this long.
 * Without it the Farm tab asked again at once and restarted the round: a loop of searches that got
 * the player's IP blocked by GGG at the 3.30 launch (2026-11-14).
 */
const kFarmTradePauseMs = 30 * 60 * 1000;
/** A price check this recent pauses the farm lookups (the player comes first). */
const kFarmTradeYieldMs = 30_000;
const kFarmTradeFile = "farm-trade-prices.json";

interface FarmTradeCache {
  league: string;
  /** name -> price and when it was looked up (null = the trade site has no usable listing) */
  prices: Record<string, { at: number; price: TradeNamePrice | null }>;
}

export class PriceService {
  readonly ninja: NinjaClient;
  readonly trade: TradeClient;
  private readonly checker: PriceChecker;
  private statIndex: Promise<StatIndex | null> | null = null;
  leagues: string[] = [];
  private lastClipboard = "";
  private clipboardTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private unwatch: (() => void) | null = null;
  private lastPriceDiag = "";
  /** items priced since the app started (session summaries): one entry per copy, best known value */
  readonly history: { ts: number; name: string; chaos: number | null }[] = [];
  /** last checked items, newest first (with their text, to check them again) */
  private recentChecks: (PriceRecent & { text: string; seq: number })[] = [];
  private recentId = 0;
  /** farm prices from the trade site, per league (file in the user folder) */
  private farmTrade: FarmTradeCache | null = null;
  private farmTradeJob: Promise<void> | null = null;
  private farmTradeLeft = 0;
  private farmTradePauseUntil = 0;
  /** bumps when the trade lookups finish: the farm tab asks for prices again */
  farmPricesVersion = 0;
  /** the last farm prices (session earnings use them without asking the network again) */
  lastFarmPrices: FarmPricesResult | null = null;
  lastFarmPricesAt = 0;
  /** last time the player used the trade site (price check, re-search, more results) */
  private lastUserTradeAt = 0;
  private itemKeys: Promise<Map<string, ItemQueryKey> | null> | null = null;

  constructor(
    private readonly platform: Platform,
    private readonly ctx: PriceContext,
  ) {
    this.ninja = new NinjaClient(platform.fetch, platform.userAgent);
    this.trade = new TradeClient(platform.fetch, platform.userAgent);
    this.checker = new PriceChecker({
      ninja: this.ninja,
      trade: this.trade,
      stats: () => this.loadStats(),
      staticIds: () => this.loadStatic(),
      onUpdate: (v) => this.onPrice(v),
      equipped: () => this.ctx.equipped(),
    });
  }

  private staticIdx: Promise<StaticIds | null> | null = null;

  /** Bulk exchange ids (currency, fragments, cards...): cached in the user folder, refreshed daily. */
  private loadStatic(): Promise<StaticIds | null> {
    if (this.staticIdx) return this.staticIdx;
    const file = "trade-static.json";
    const p = this.platform;
    this.staticIdx = (async () => {
      const age = await p.userFileAge(file);
      if (age !== null && Date.now() - age < kStatsMaxAgeMs) {
        const text = await p.readUserFile(file);
        if (text) return staticIds(JSON.parse(text));
      }
      try {
        const data = await fetchStatic(p.fetch, p.userAgent);
        await p.writeUserFile(file, JSON.stringify(data));
        return staticIds(data);
      } catch (e) {
        console.error("could not load trade static data", e);
        const text = await p.readUserFile(file);
        if (text) return staticIds(JSON.parse(text));
        this.staticIdx = null;
        return null;
      }
    })();
    return this.staticIdx;
  }

  /** The next 10 listings of the current trade search. */
  more(): Promise<void> {
    this.lastUserTradeAt = Date.now();
    return this.checker.more();
  }

  /** Unique names and item types the trade site knows (one search per farm item): cached daily. */
  private loadItemKeys(): Promise<Map<string, ItemQueryKey> | null> {
    if (this.itemKeys) return this.itemKeys;
    const file = "trade-items.json";
    const p = this.platform;
    this.itemKeys = (async () => {
      const age = await p.userFileAge(file);
      if (age !== null && Date.now() - age < kStatsMaxAgeMs) {
        const text = await p.readUserFile(file);
        if (text) return itemQueryKeys(JSON.parse(text));
      }
      try {
        const data = await fetchItemsData(p.fetch, p.userAgent);
        await p.writeUserFile(file, JSON.stringify(data));
        return itemQueryKeys(data);
      } catch (e) {
        console.error("could not load trade item list", e);
        const text = await p.readUserFile(file);
        if (text) return itemQueryKeys(JSON.parse(text));
        this.itemKeys = null;
        return null;
      }
    })();
    return this.itemKeys;
  }

  get view(): PriceView | null {
    return this.checker.view;
  }
  get watching(): boolean {
    return !!this.clipboardTimer || !!this.unwatch;
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

  /** Trade stat list (~2 MB): cached in the user folder, refreshed daily. */
  loadStats(): Promise<StatIndex | null> {
    if (this.statIndex) return this.statIndex;
    const file = "trade-stats.json";
    const p = this.platform;
    this.statIndex = (async () => {
      const age = await p.userFileAge(file);
      if (age !== null && Date.now() - age < kStatsMaxAgeMs) {
        const text = await p.readUserFile(file);
        if (text) return new StatIndex(JSON.parse(text) as TradeStatsData);
      }
      try {
        const data = (await fetchStats(p.fetch, p.userAgent)) as TradeStatsData;
        await p.writeUserFile(file, JSON.stringify(data));
        return new StatIndex(data);
      } catch (e) {
        console.error("could not load trade stats", e);
        const text = await p.readUserFile(file); // stale cache is better than nothing
        if (text) return new StatIndex(JSON.parse(text) as TradeStatsData);
        this.statIndex = null; // try again on the next item
        return null;
      }
    })();
    return this.statIndex;
  }

  private translator: Promise<ModTranslator | null> | null = null;

  /** Mod lines in Portuguese (GGG's own texts from the Brazilian trade site, cached daily like the English list). */
  loadTranslator(): Promise<ModTranslator | null> {
    if (this.translator) return this.translator;
    const file = "trade-stats-pt.json";
    const p = this.platform;
    this.translator = (async () => {
      const en = await this.loadStats();
      if (!en) {
        this.translator = null;
        return null;
      }
      let text: string | null = null;
      const age = await p.userFileAge(file);
      if (age !== null && Date.now() - age < kStatsMaxAgeMs) text = await p.readUserFile(file);
      if (!text) {
        try {
          const data = await fetchStats(p.fetch, p.userAgent, "https://br.pathofexile.com");
          text = JSON.stringify(data);
          await p.writeUserFile(file, text);
        } catch (e) {
          console.error("could not load the Portuguese stat list", e);
          text = await p.readUserFile(file);
        }
      }
      if (!text) {
        this.translator = null; // try again later
        return null;
      }
      return new ModTranslator(en.raw, JSON.parse(text) as TradeStatsData);
    })();
    return this.translator;
  }

  // ---- clipboard ------------------------------------------------------------------

  async applyClipboardWatch(): Promise<void> {
    const on = this.ctx.config().priceCheckEnabled;
    const p = this.platform;
    if (on && !this.watching) {
      this.lastClipboard = await p.readClipboard().catch(() => ""); // don't price what was there before
      // the platform tells us when something is copied; otherwise look every kClipboardPollMs
      if (p.watchClipboard) this.unwatch = p.watchClipboard((text) => this.onClipboardText(text));
      else this.clipboardTimer = setInterval(() => void this.pollClipboard(), kClipboardPollMs);
    } else if (!on && this.watching) {
      if (this.clipboardTimer) clearInterval(this.clipboardTimer);
      this.clipboardTimer = null;
      this.unwatch?.();
      this.unwatch = null;
    }
  }

  /** Text the app itself put on the clipboard: the watcher must not look at it. */
  async writeClipboard(text: string): Promise<void> {
    this.lastClipboard = text;
    await this.platform.writeClipboard(text);
  }

  private async pollClipboard(): Promise<void> {
    if (this.polling) return; // a slow read must not stack up
    this.polling = true;
    try {
      this.onClipboardText(await this.platform.readClipboard());
    } catch {
      /* clipboard busy (another app has it open): next tick */
    } finally {
      this.polling = false;
    }
  }

  // ---- price key (Ctrl+D) -----------------------------------------------------------------

  private hotkey: { before: string; onItem: () => void; timer: ReturnType<typeof setTimeout> } | null = null;

  /** The next item copied in the next 2 s came from the price key: show it, then restore `before`. */
  expectHotkeyItem(before: string, onItem: () => void): void {
    this.cancelHotkey();
    const timer = setTimeout(() => {
      if (this.hotkey?.timer !== timer) return;
      this.hotkey = null;
      this.ctx.addDiag("preço", "atalho de preço: nada foi copiado (o mouse estava sobre um item?)");
      this.ctx.broadcast();
    }, 2000);
    this.hotkey = { before, onItem, timer };
  }

  cancelHotkey(): void {
    if (this.hotkey) clearTimeout(this.hotkey.timer);
    this.hotkey = null;
  }

  private onClipboardText(text: string): void {
    // the same item twice is a new check when it came from the price key
    if (text === this.lastClipboard && !this.hotkey) return;
    this.lastClipboard = text;
    // only item text copied from the game and Path of Building codes/links are looked at
    // Ctrl+C goes to the equipment tab (register / compare); the price key's copy is priced
    if (/^Item Class: /.test(text) && !this.hotkey && this.ctx.gearItem(text)) return;
    const league = this.league();
    if (league && this.checker.check(text, league)) {
      this.lastUserTradeAt = Date.now();
      this.remember(text);
      const it = this.checker.view?.item;
      this.ctx.addDiag("clipboard", `item copiado: ${it ? `${it.name || it.baseType} (${it.rarity}, ${it.itemClass})` : "?"}`);
      const hk = this.hotkey;
      if (hk) {
        this.cancelHotkey();
        hk.onItem();
        // put back what the player had on the clipboard (the watcher ignores our own write)
        if (hk.before && hk.before !== text) void this.writeClipboard(hk.before).catch(() => {});
      }
      return;
    }
    if (looksLikePob(text)) {
      this.ctx.onPobText(text);
      return;
    }
    if (!league && /^Item Class: /.test(text)) this.ctx.addDiag("clipboard", "item copiado, mas a liga ainda não carregou");
    // anything else the user copies is none of our business: not even logged
  }

  private onPrice(v: PriceView): void {
    const settled = (s: string) => s !== "loading" && s !== "idle";
    const key = `${v.seq}:${v.ninjaStatus}:${v.tradeStatus}`;
    if (settled(v.ninjaStatus) && settled(v.tradeStatus) && key !== this.lastPriceDiag) {
      this.lastPriceDiag = key;
      const parts = [
        v.ninja
          ? `poe.ninja ${Math.round(v.ninja.chaos)}c`
          : `poe.ninja ${v.ninjaStatus === "error" ? `erro (${v.ninjaError})` : "sem referência"}`,
        v.tradeStatus === "n/a"
          ? "trade: não se aplica"
          : v.trade
            ? `trade ${v.trade.total} anúncios${v.trade.medianChaos !== null ? `, ~${Math.round(v.trade.medianChaos)}c` : ""}`
            : `trade erro (${v.tradeError})`,
      ];
      this.ctx.addDiag("preço", `${v.item.name || v.item.baseType}: ${parts.join(" · ")}`);
      const stack = v.item.stackSize && v.item.stackSize > 1 ? v.item.stackSize : 1;
      const chaos = v.ninja ? v.ninja.chaos * stack : v.trade?.medianChaos ?? null;
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

  research(patch: PriceSearchPatch): void {
    this.lastUserTradeAt = Date.now();
    this.checker.research(patch);
  }

  openItemTrade(): void {
    const v = this.checker.view;
    const url = v?.trade?.url ?? v?.bulk?.url;
    if (url && url.startsWith(kTradeSite)) this.platform.openExternal(url);
  }

  /** Live prices for every item in the farm tables (poe.ninja, cached 30 min). */
  async farmPrices(): Promise<FarmPricesResult> {
    const league = this.league();
    if (!league) return { league: null, chaosPerDivine: null, prices: {}, suspect: [], tradePending: 0, error: tr("liga ainda não carregada", "league not loaded yet") };
    try {
      const [found, rates] = await Promise.all([
        priceByName(this.ninja, league, farmItemNames(FARM_BOSSES)),
        this.ninja.currencyRates(league).catch(() => null),
      ]);
      const cpd = rates?.get("divine") ?? null;
      const cache = await this.loadFarmTrade(league);
      const prices: FarmPricesResult["prices"] = {};
      const suspect: string[] = [];
      const lookup: string[] = [];
      for (const name of farmItemNames(FARM_BOSSES)) {
        const p = found.get(name);
        if (!needsTradePrice(p, cpd)) {
          prices[name] = { chaos: p!.chaos, lowConfidence: p!.lowConfidence, variants: p!.variants, source: "ninja", listings: p!.listings };
          continue;
        }
        const t = cache.prices[name];
        if (t?.price) prices[name] = { chaos: t.price.chaos, lowConfidence: t.price.listings < 5, variants: 1, source: "trade", listings: t.price.listings };
        else if (p && isSuspect(p, cpd)) suspect.push(name);
        if (!t || Date.now() - t.at > kFarmTradeMaxAgeMs) lookup.push(name);
      }
      if (lookup.length) this.startFarmTrade(league, lookup, rates);
      this.lastFarmPrices = { league, chaosPerDivine: cpd, prices, suspect, tradePending: this.farmTradeLeft, error: null };
      this.lastFarmPricesAt = Date.now();
      return this.lastFarmPrices;
    } catch (e) {
      return { league, chaosPerDivine: null, prices: {}, suspect: [], tradePending: 0, error: (e as Error).message };
    }
  }

  private async loadFarmTrade(league: string): Promise<FarmTradeCache> {
    if (this.farmTrade?.league === league) return this.farmTrade;
    try {
      const text = await this.platform.readUserFile(kFarmTradeFile);
      const c = text ? (JSON.parse(text) as FarmTradeCache) : null;
      this.farmTrade = c?.league === league && c.prices ? c : { league, prices: {} };
    } catch {
      this.farmTrade = { league, prices: {} };
    }
    return this.farmTrade;
  }

  /** Looks the items up one by one in the background, then tells the farm tab to ask again. */
  private startFarmTrade(league: string, names: string[], rates: Map<string, number> | null): void {
    if (this.farmTradeJob || Date.now() < this.farmTradePauseUntil) return;
    this.farmTradeLeft = names.length;
    this.farmTradeJob = (async () => {
      const cache = await this.loadFarmTrade(league);
      const keys = await this.loadItemKeys();
      let failures = 0;
      let priced = 0;
      for (const name of names) {
        if (this.league() !== league) break;
        // the player's price checks come first
        while (Date.now() - this.lastUserTradeAt < kFarmTradeYieldMs) await new Promise((r) => setTimeout(r, 5000));
        if (this.trade.searchUsage > kFarmTradeMaxUsage) {
          this.ctx.addDiag("preço", "farm: pausado para não gastar o limite de buscas do trade");
          this.farmTradePauseUntil = Date.now() + kFarmTradePauseMs;
          break;
        }
        try {
          cache.prices[name] = { at: Date.now(), price: await tradePriceByName(this.trade, league, name, rates, keys?.get(name)) };
          priced++;
        } catch (e) {
          // rate limit or network: stop, and no new round for a while (see kFarmTradePauseMs)
          if (++failures >= 2) {
            console.error("farm trade prices stopped", e);
            this.ctx.addDiag("preço", `farm: buscas no trade paradas por 30 min (${(e as Error).message})`);
            this.farmTradePauseUntil = Date.now() + kFarmTradePauseMs;
            break;
          }
          await new Promise((r) => setTimeout(r, kFarmTradeGapMs));
          continue;
        }
        this.farmTradeLeft--;
        // keep what is known so far (closing the app mid-way loses nothing) and show it
        await this.platform.writeUserFile(kFarmTradeFile, JSON.stringify(cache)).catch(() => {});
        this.farmPricesVersion++;
        this.ctx.broadcast();
        if (this.farmTradeLeft > 0) await new Promise((r) => setTimeout(r, kFarmTradeGapMs));
      }
      if (priced) this.ctx.addDiag("preço", `farm: preços do trade atualizados (${priced} de ${names.length} itens)`);
      return priced;
    })()
      .catch(() => 0)
      .then((priced) => {
        this.farmTradeJob = null;
        this.farmTradeLeft = 0;
        // only news makes the Farm tab ask again (asking again restarts a round)
        if (priced) {
          this.farmPricesVersion++;
          this.ctx.broadcast();
        }
      });
  }

  /**
   * Opens the official trade site with the maps the Buscas tab describes: registers the search
   * through the API (official result link), or falls back to a ?q= link when the API refuses.
   */
  async openMapTrade(o: MapTradeOptions): Promise<{ ok: boolean; total?: number; missing: string[]; error?: string }> {
    const league = this.league();
    if (!league) return { ok: false, missing: [], error: tr("liga ainda não carregada", "league not loaded yet") };
    const stats = await this.loadStats();
    if (!stats) return { ok: false, missing: [], error: tr("lista de mods do trade indisponível (sem internet?)", "the trade site's mod list is unavailable (no internet?)") };
    const { query, missing } = mapTradeQuery(o, mapModStatIds(stats.raw));
    let url: string;
    let total: number | undefined;
    try {
      const r = await this.trade.searchId(league, query);
      url = r.url;
      total = r.total;
    } catch (e) {
      console.error("map trade search via API failed, using ?q= link", e);
      url = tradeSearchUrl(league, query);
    }
    if (!url.startsWith(kTradeSite)) return { ok: false, missing, error: tr("link inválido", "invalid link") };
    this.platform.openExternal(url);
    this.ctx.addDiag("app", `trade de mapas aberto${total !== undefined ? ` (${total} resultados)` : ""}`);
    return { ok: true, total, missing };
  }
}
