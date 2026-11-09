// Prices: the clipboard watcher (items -> price check, PoB codes -> build import), leagues,
// poe.ninja, the trade site (item listings, map searches) and the trade stat list.
import type { DiagKind } from "../core/diag";
import { farmItemNames } from "../core/farm";
import { mapModStatIds, mapTradeQuery, tradeSearchUrl, type MapTradeOptions } from "../core/mapTrade";
import { NinjaClient, priceByName } from "../core/ninja";
import { looksLikePob } from "../core/pob";
import { PriceChecker } from "../core/pricecheck";
import { StatIndex, type TradeStatsData } from "../core/stats";
import { TradeClient, defaultLeague, fetchLeagues, fetchStats } from "../core/trade";
import { FARM_BOSSES } from "../shared/farmData";
import type { FarmPricesResult } from "../shared/ipc";
import type { AppConfig, PriceView } from "../shared/types";
import { kClipboardPollMs, kStatsMaxAgeMs, kTradeSite } from "./constants";
import type { Platform } from "./platform";

export interface PriceContext {
  config(): AppConfig;
  broadcast(): void;
  addDiag(kind: DiagKind, text: string): void;
  /** clipboard text that looks like a Path of Building code or link */
  onPobText(text: string): void;
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
      onUpdate: (v) => this.onPrice(v),
    });
  }

  get view(): PriceView | null {
    return this.checker.view;
  }
  get watching(): boolean {
    return !!this.clipboardTimer || !!this.unwatch;
  }

  /** League used for prices: the configured one, else the current challenge league. */
  league(): string | null {
    return this.ctx.config().league ?? defaultLeague(this.leagues);
  }

  async loadLeagues(): Promise<void> {
    try {
      this.leagues = await fetchLeagues(this.platform.fetch, this.platform.userAgent);
      this.ctx.broadcast();
    } catch (e) {
      console.error("could not load leagues", e);
    }
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
    const league = this.league();
    if (league && this.checker.check(text, league)) {
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
      if (this.history.length > 500) this.history.splice(0, this.history.length - 500);
    }
    this.ctx.broadcast();
  }

  research(patch: { statId: string; enabled: boolean; min: number | null }[]): void {
    this.checker.research(patch);
  }

  openItemTrade(): void {
    const url = this.checker.view?.trade?.url;
    if (url && url.startsWith(kTradeSite)) this.platform.openExternal(url);
  }

  /** Live prices for every item in the farm tables (poe.ninja, cached 30 min). */
  async farmPrices(): Promise<FarmPricesResult> {
    const league = this.league();
    if (!league) return { league: null, chaosPerDivine: null, prices: {}, error: "liga ainda não carregada" };
    try {
      const [found, rates] = await Promise.all([
        priceByName(this.ninja, league, farmItemNames(FARM_BOSSES)),
        this.ninja.currencyRates(league).catch(() => null),
      ]);
      const prices: FarmPricesResult["prices"] = {};
      for (const [name, p] of found) prices[name] = { chaos: p.chaos, lowConfidence: p.lowConfidence, variants: p.variants };
      return { league, chaosPerDivine: rates?.get("divine") ?? null, prices, error: null };
    } catch (e) {
      return { league, chaosPerDivine: null, prices: {}, error: (e as Error).message };
    }
  }

  /**
   * Opens the official trade site with the maps the Buscas tab describes: registers the search
   * through the API (official result link), or falls back to a ?q= link when the API refuses.
   */
  async openMapTrade(o: MapTradeOptions): Promise<{ ok: boolean; total?: number; missing: string[]; error?: string }> {
    const league = this.league();
    if (!league) return { ok: false, missing: [], error: "liga ainda não carregada" };
    const stats = await this.loadStats();
    if (!stats) return { ok: false, missing: [], error: "lista de mods do trade indisponível (sem internet?)" };
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
    if (!url.startsWith(kTradeSite)) return { ok: false, missing, error: "link inválido" };
    this.platform.openExternal(url);
    this.ctx.addDiag("app", `trade de mapas aberto${total !== undefined ? ` (${total} resultados)` : ""}`);
    return { ok: true, total, missing };
  }
}
