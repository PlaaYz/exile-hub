// Prices: the clipboard watcher (items -> price check, PoB codes -> build import), leagues,
// poe.ninja, the trade site (item listings, map searches) and the trade stat list.
import { clipboard, shell } from "electron";
import fs from "node:fs";
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
import { httpFetch, kClipboardPollMs, kStatsMaxAgeMs, kUserAgent, readJson, userFile } from "./env";

export interface PriceContext {
  config(): AppConfig;
  broadcast(): void;
  addDiag(kind: DiagKind, text: string): void;
  /** clipboard text that looks like a Path of Building code or link */
  onPobText(text: string): void;
}

const kTradeSite = "https://www.pathofexile.com/trade/";

export class PriceService {
  readonly ninja = new NinjaClient(httpFetch, kUserAgent);
  readonly trade = new TradeClient(httpFetch, kUserAgent);
  private readonly checker: PriceChecker;
  private statIndex: Promise<StatIndex | null> | null = null;
  leagues: string[] = [];
  private lastClipboard = "";
  private clipboardTimer: NodeJS.Timeout | null = null;
  private lastPriceDiag = "";
  /** items priced since the app started (session summaries): one entry per copy, best known value */
  readonly history: { ts: number; name: string; chaos: number | null }[] = [];

  constructor(private readonly ctx: PriceContext) {
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
    return !!this.clipboardTimer;
  }

  /** League used for prices: the configured one, else the current challenge league. */
  league(): string | null {
    return this.ctx.config().league ?? defaultLeague(this.leagues);
  }

  async loadLeagues(): Promise<void> {
    try {
      this.leagues = await fetchLeagues(httpFetch, kUserAgent);
      this.ctx.broadcast();
    } catch (e) {
      console.error("could not load leagues", e);
    }
  }

  /** Trade stat list (~2 MB): cached in userData, refreshed daily. */
  loadStats(): Promise<StatIndex | null> {
    if (this.statIndex) return this.statIndex;
    const file = userFile("trade-stats.json");
    this.statIndex = (async () => {
      try {
        if (Date.now() - fs.statSync(file).mtimeMs < kStatsMaxAgeMs) return new StatIndex(readJson<TradeStatsData>(file));
      } catch {
        /* no cache yet */
      }
      try {
        const data = (await fetchStats(httpFetch, kUserAgent)) as TradeStatsData;
        fs.writeFileSync(file, JSON.stringify(data));
        return new StatIndex(data);
      } catch (e) {
        console.error("could not load trade stats", e);
        try {
          return new StatIndex(readJson<TradeStatsData>(file)); // stale cache is better than nothing
        } catch {
          this.statIndex = null; // try again on the next item
          return null;
        }
      }
    })();
    return this.statIndex;
  }

  // ---- clipboard ------------------------------------------------------------------

  applyClipboardWatch(): void {
    const on = this.ctx.config().priceCheckEnabled;
    if (on && !this.clipboardTimer) {
      this.lastClipboard = clipboard.readText(); // don't price whatever was there before
      this.clipboardTimer = setInterval(() => this.pollClipboard(), kClipboardPollMs);
    } else if (!on && this.clipboardTimer) {
      clearInterval(this.clipboardTimer);
      this.clipboardTimer = null;
    }
  }

  /** Text the app itself put on the clipboard: the watcher must not look at it. */
  writeClipboard(text: string): void {
    this.lastClipboard = text;
    clipboard.writeText(text);
  }

  private pollClipboard(): void {
    const text = clipboard.readText();
    if (text === this.lastClipboard) return;
    this.lastClipboard = text;
    // only item text copied from the game and Path of Building codes/links are looked at
    const league = this.league();
    if (league && this.checker.check(text, league)) {
      const it = this.checker.view?.item;
      this.ctx.addDiag("clipboard", `item copiado: ${it ? `${it.name || it.baseType} (${it.rarity}, ${it.itemClass})` : "?"}`);
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
    if (url && url.startsWith(kTradeSite)) void shell.openExternal(url);
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
    void shell.openExternal(url);
    this.ctx.addDiag("app", `trade de mapas aberto${total !== undefined ? ` (${total} resultados)` : ""}`);
    return { ok: true, total, missing };
  }
}
