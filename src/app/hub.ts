// The app itself, independent of Electron or Tauri: settings, play session, build, services and the
// state the windows show. The platform (Platform + Shell) provides files, clipboard, HTTP, the PoB
// engine, windows and the tray.
import { measuredMinutes } from "../core/bossRuns";
import { cleanChatCommands, expandCommand, isValidKey, normaliseKey } from "../core/chatCommands";
import { parseLine, type LogEvent } from "../core/clientLog";
import { describeEvent, type DiagKind } from "../core/diag";
import { sessionDurationMs, type GameSession } from "../core/gameSessions";
import type { GemInfo } from "../core/gemAvailability";
import { importPobEquipped, type EquippedItem } from "../core/itemCompare";
import type { MapTradeOptions } from "../core/mapTrade";
import { applyGemLevels, gemLevelTable, importPob, pobSourceUrl } from "../core/pob";
import type { Lookups } from "../core/route";
import { gemColors } from "../core/searchRegex";
import { Session, type ProgressData } from "../core/session";
import type { FarmPricesResult, ImportResult } from "../shared/ipc";
import type { AppConfig, AppState, ChallengesView, DisplayInfo, PobBuild, PriceSearchPatch, TradeAction, TradeCard, TreeLayout } from "../shared/types";
import type { TradeOffer } from "../core/tradeWhisper";

/** Buy request cards kept, and for how long. */
const kMaxTradeCards = 6;
const kTradeCardMs = 15 * 60 * 1000;
import { ChallengeService } from "./challengeService";
import { ConfigStore } from "./config";
import { kIssuesUrl, kPobFetchTimeoutMs, kProgressSaveMs } from "./constants";
import { Diagnostics } from "./diagnostics";
import { LogService } from "./logService";
import type { Platform } from "./platform";
import { PriceService } from "./priceService";
import { TreeService } from "./treeService";

export class Hub {
  private readonly cfg: ConfigStore;
  private lookups!: Lookups;
  private gemsData!: Record<string, GemInfo>;
  private gemLevels!: Map<string, number>;
  private session!: Session;
  private build: PobBuild | null = null;
  /** what the build wears, for "compare with my item" */
  private equipped: EquippedItem[] = [];
  private buildInfo: AppState["buildInfo"] = null;
  /** from "[WINDOW] Gained/Lost focus" in Client.txt; unknown at start = treat as focused */
  private gameFocused = true;
  /** game process running, as far as the log tells (closing line / new log session) */
  private gameRunning = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private overlayInteractive = false;
  private startWithWindowsCache = false;
  /** last player who whispered you (Client.txt), for "/invite {last_whisper}" */
  private lastWhisper: string | null = null;
  /** command keys registered now, joined (change detection) */
  private commandKeys = "";
  private ready = false;

  readonly diag = new Diagnostics();
  log!: LogService;
  prices!: PriceService;
  private tree!: TreeService;
  private challenges!: ChallengeService;

  private constructor(private readonly p: Platform) {
    this.cfg = new ConfigStore(p);
  }

  /** Loads data, settings and saved progress; the caller then starts the log and the windows. */
  static async create(p: Platform): Promise<Hub> {
    const hub = new Hub(p);
    await hub.init();
    return hub;
  }

  private async init(): Promise<void> {
    const p = this.p;
    const [areas, quests, gems, ...routeTexts] = await Promise.all([
      p.readData("json/areas.json"),
      p.readData("json/quests.json"),
      p.readData("json/gems.json"),
      ...Array.from({ length: 10 }, (_, i) => p.readData(`routes/act-${i + 1}.txt`)),
    ]);
    this.lookups = { areas: JSON.parse(areas), quests: JSON.parse(quests) };
    this.gemsData = JSON.parse(gems);
    this.gemLevels = gemLevelTable(this.gemsData);
    await this.cfg.load();
    this.session = new Session(this.lookups, routeTexts, this.config.leagueStart);
    // the account's characters (every level-up in the whole log), once LogService has read it
    this.session.known = (name) => this.log?.characters.get(name);

    const addDiag = (kind: DiagKind, text: string) => this.diag.add(kind, text);
    const broadcast = () => this.broadcast();
    const config = () => this.config;
    this.log = new LogService(p, {
      onEvent: (ev) => this.onEvent(ev),
      onParsed: (ev) => {
        const d = describeEvent(ev, (id) => this.lookups.areas[id]);
        if (d) this.diag.add(d.kind, d.text);
      },
      onRawLine: () => this.diag.lineSeen(),
      onScanDone: (playing) => this.onScanDone(playing),
      addDiag,
      broadcast,
      // campaign zones only ("1_1_2"...), acts 1-10: hideouts and the endgame town do not count
      actOf: (id) => {
        const act = /^\d_\d+_/.test(id) ? this.lookups.areas[id]?.act : undefined;
        return act && act <= 10 ? act : null;
      },
    });
    this.prices = new PriceService(p, {
      config,
      broadcast,
      addDiag,
      onPobText: (text) => {
        this.diag.add("clipboard", "código/link do Path of Building copiado: importando");
        void this.importBuild(text, "clipboard").then((r) =>
          this.diag.add("clipboard", r.ok ? "build importado do clipboard" : `não era um build válido (${r.error})`),
        );
      },
      equipped: () => this.equipped,
    });
    this.tree = new TreeService(p, broadcast);
    this.challenges = new ChallengeService(p);
    p.diag = addDiag;
    await this.loadProgress();
    await this.loadBuild();
    this.startWithWindowsCache = await p.shell.startWithWindows().catch(() => false);
  }

  /** After the windows exist: follow the log, watch the clipboard, load leagues. */
  async start(): Promise<void> {
    this.ready = true;
    if (!this.config.clientLogPath) {
      const found = await this.p.detectLog();
      if (found) this.setConfig({ clientLogPath: found });
    } else {
      await this.startTail();
    }
    void this.prices.loadLeagues();
    await this.prices.applyClipboardWatch();
    this.updateTray();
    this.applyOverlayVisibility();
    this.broadcast();
  }

  get config(): AppConfig {
    return this.cfg.value;
  }

  setConfig(patch: Partial<AppConfig>): void {
    const prev = this.cfg.update(patch);
    if (patch.leagueStart !== undefined && patch.leagueStart !== prev.leagueStart) this.session.rebuild(this.config.leagueStart);
    if (patch.clientLogPath !== undefined && patch.clientLogPath !== prev.clientLogPath) void this.startTail();
    if (patch.overlayEnabled !== undefined || patch.overlayHideUnfocused !== undefined) this.applyOverlayVisibility();
    if (patch.priceCheckEnabled !== undefined) void this.prices.applyClipboardWatch();
    if (
      patch.chatCommandsEnabled !== undefined ||
      patch.chatCommands !== undefined ||
      patch.priceCheckKey !== undefined ||
      patch.priceCheckEnabled !== undefined
    ) {
      this.applyCommandKeys();
    }
    this.updateTray();
    this.broadcast();
  }

  // ---- persistence: route/timers per character, last build -------------------------------

  private async loadProgress(): Promise<void> {
    try {
      const text = await this.p.readUserFile("progress.json");
      if (text) this.session.importProgress(JSON.parse(text) as ProgressData);
    } catch {
      /* first run */
    }
  }

  async saveProgress(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      await this.p.writeUserFile("progress.json", JSON.stringify(this.session.exportProgress()));
    } catch (e) {
      console.error("could not save progress", e);
    }
  }

  /** Progress changes on every zone: write at most every few seconds. */
  private scheduleSave(): void {
    if (!this.saveTimer) this.saveTimer = setTimeout(() => void this.saveProgress(), kProgressSaveMs);
  }

  private async loadBuild(): Promise<void> {
    try {
      const text = await this.p.readUserFile("build.json");
      if (!text) return;
      const saved = JSON.parse(text) as { code: string; at: number };
      this.build = applyGemLevels(importPob(saved.code), this.gemLevels);
      this.equipped = equippedOf(saved.code);
      this.buildInfo = { source: "saved", at: saved.at };
    } catch {
      /* no saved build */
    }
  }

  async importBuild(input: string, source: "manual" | "clipboard" = "manual"): Promise<ImportResult> {
    try {
      let code = input.trim();
      const url = pobSourceUrl(code);
      if (url) {
        code = (await this.p.fetchText(url, kPobFetchTimeoutMs)).trim();
      }
      this.build = applyGemLevels(importPob(code), this.gemLevels);
      this.equipped = equippedOf(code);
      const at = Date.now();
      this.buildInfo = { source, at };
      await this.p.writeUserFile("build.json", JSON.stringify({ code, at })).catch((e) => console.error("could not save build", e));
      this.broadcast();
      return { ok: true };
    } catch (e) {
      // copied text that only looked like a PoB code: stay quiet
      return { ok: false, error: (e as Error).message };
    }
  }

  // ---- Client.txt ------------------------------------------------------------------------

  detectLog(): Promise<string | null> {
    return this.p.detectLog();
  }

  async pickLog(): Promise<void> {
    const file = await this.p.pickLogFile();
    if (file) this.setConfig({ clientLogPath: file });
  }

  async startTail(): Promise<void> {
    const file = this.config.clientLogPath;
    if (!file) {
      this.log.stop();
      return;
    }
    this.diag.add("app", `lendo ${file}`);
    const tail = await this.log.start(file);
    // learn where the player is from the end of the log
    this.session.backfill(tail);
    // is the game focused right now? (last focus line; none = game not started yet)
    let focusSeen = false;
    for (let i = tail.length - 1; i >= 0 && !(focusSeen && this.lastWhisper); i--) {
      const ev = parseLine(tail[i]);
      if (ev?.type === "focus" && !focusSeen) {
        focusSeen = true;
        this.gameFocused = ev.focused;
        // the app started while the game was already running: no "open the dashboard" later
        this.gameRunning = !ev.closing;
      } else if (ev?.type === "whisper" && !this.lastWhisper) {
        this.lastWhisper = ev.from;
      }
    }
    this.scheduleSave();
    if (this.gameRunning) this.p.shell.gameRunningChanged?.(true);
    this.applyOverlayVisibility();
    this.applyCommandKeys();
  }

  private onScanDone(playing: string | null): void {
    // the whole log knows every character's level and who played last (the tail alone may not)
    const before = this.session.characterName;
    if (playing && playing !== before) this.session.identify(playing);
    this.session.refreshFromKnown();
    if (this.session.characterName !== before && this.session.characterName) {
      this.diag.add("personagem", `personagem atual: ${this.session.characterName}`);
    }
    this.scheduleSave();
    this.broadcast();
  }

  /** A live Client.txt event (the history trackers already saw it). */
  private onEvent(ev: LogEvent): void {
    if (ev.type === "focus") {
      if (ev.closing && !ev.opening) this.announceSessionEnd();
      this.gameFocused = ev.focused;
      this.onGameFocus(ev);
      this.applyOverlayVisibility();
      this.applyCommandKeys();
      return;
    }
    if (ev.type === "whisper") {
      this.lastWhisper = ev.from;
      if (ev.offer) this.addTradeCard(ev.from, ev.offer, ev.ts ?? Date.now());
      return;
    }
    if (ev.type === "join") {
      // the buyer came to your hideout: their card says so
      let changed = false;
      this.trades = this.trades.map((t) => (t.from === ev.name && !t.arrived ? ((changed = true), { ...t, arrived: true }) : t));
      if (changed) this.broadcast();
      return;
    }
    const s = this.session;
    const charBefore = s.characterName;
    const cursorBefore = s.tracker.cursor;
    const offBefore = s.tracker.offRoute;
    if (!s.apply(ev)) return;
    if (ev.type === "area" && s.characterName === null && charBefore !== null) {
      this.diag.add("personagem", "nova run detectada (personagem novo na Twilight Strand): rota e tempos zerados");
    } else if (s.characterName !== charBefore && s.characterName) {
      this.diag.add("personagem", `personagem atual: ${s.characterName}`);
    }
    if (ev.type === "area" && Math.abs(s.tracker.cursor - cursorBefore) > 8) {
      this.diag.add("zona", `rota pulou para o passo ${s.tracker.cursor} de ${s.tracker.steps.length}`);
    }
    if (s.tracker.offRoute && !offBefore) this.diag.add("zona", "fora da rota: zona da campanha que a rota não visita");
    this.scheduleSave();
    this.broadcast();
    if (ev.type === "area") this.updateTray();
  }

  /** From the log: the game opened (focus after a closing) or closed. */
  private onGameFocus(ev: { focused: boolean; closing?: true }): void {
    if (ev.closing) {
      if (this.gameRunning) this.p.shell.gameRunningChanged?.(false);
      this.gameRunning = false;
      return;
    }
    if (ev.focused && !this.gameRunning) {
      this.gameRunning = true;
      this.p.shell.gameRunningChanged?.(true);
      if (this.config.showDashboardOnGameStart) this.p.shell.showDashboard(false);
    }
  }

  /** The game just closed: the session summary as a Windows notification. */
  private announceSessionEnd(): void {
    const last = this.log.sessions.recent(1)[0];
    if (!last || last.end === null) return;
    const v = sessionView(last, this.prices.history);
    const mins = Math.round(v.durationMs / 60000);
    const time = mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}` : `${mins} min`;
    const parts = [time];
    if (v.maps) parts.push(`${v.maps} mapas`);
    if (v.bossRuns) parts.push(`${v.bossRuns} bosses`);
    for (const ch of v.characters) if (ch.to > ch.from) parts.push(`${ch.name} ${ch.from}→${ch.to}`);
    parts.push(`${v.deaths} morte${v.deaths === 1 ? "" : "s"}`);
    this.p.shell.notify("Sessão encerrada", parts.join(" · "));
    this.diag.add("jogo", `sessão encerrada: ${parts.join(" · ")}`);
  }

  // ---- chat commands (F5 -> /hideout) -------------------------------------------------------

  /**
   * The command keys are registered only while the game has focus (from Client.txt), so F5 & co.
   * keep working in other programs; the platform also checks the game window is in front.
   */
  private applyCommandKeys(): void {
    const p = this.p;
    if (!this.ready || !p.setCommandKeys) return;
    const inGame = this.gameRunning && this.gameFocused;
    const keys = inGame && this.config.chatCommandsEnabled && p.sendChat ? (cleanChatCommands(this.config.chatCommands) ?? []).map((c) => c.key) : [];
    // the price check key (Ctrl+D) goes in the same set: also only while the game has focus
    const priceKey = this.priceKey();
    if (inGame && priceKey && !keys.includes(priceKey)) keys.push(priceKey);
    const sig = keys.join(",");
    if (sig === this.commandKeys) return;
    this.commandKeys = sig;
    p.setCommandKeys(keys, (key) => void (key === this.priceKey() ? this.runPriceKey() : this.runCommand(key))).catch((e: unknown) => {
      this.commandKeys = "";
      this.diag.add("comando", `não consegui registrar os atalhos: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  private priceKey(): string | null {
    const k = this.config.priceCheckKey;
    return this.config.priceCheckEnabled && this.p.copyItem && k && isValidKey(k) ? normaliseKey(k) : null;
  }

  /**
   * Ctrl+D: the game copies the item under the mouse (Ctrl+Alt+C, with mod tiers), the clipboard
   * watcher prices it and the popup opens next to it; the player's clipboard is put back afterwards.
   */
  private async runPriceKey(): Promise<void> {
    const p = this.p;
    if (!p.copyItem) return;
    const before = await p.readClipboard().catch(() => "");
    this.prices.expectHotkeyItem(before, () => void p.shell.showPricePopup?.());
    try {
      await p.copyItem();
    } catch (e) {
      this.prices.cancelHotkey();
      this.diag.add("preço", `atalho de preço: ${e instanceof Error ? e.message : String(e)}`);
      this.broadcast();
    }
  }

  priceMore(): Promise<void> {
    return this.prices.more();
  }
  priceRecheck(id: number): void {
    this.prices.recheck(id);
  }

  // ---- buy requests (whispers from the trade site) -------------------------------------------

  private trades: TradeCard[] = [];
  private tradeSeq = 0;

  private addTradeCard(from: string, offer: TradeOffer, at: number): void {
    if (!this.config.tradeAlerts) return;
    // the same buyer asking again for the same item replaces the old card
    const rest = this.trades.filter((t) => !(t.from === from && t.offer.item === offer.item) && Date.now() - t.at < kTradeCardMs);
    this.trades = [{ id: String(++this.tradeSeq), from, at, arrived: false, offer }, ...rest].slice(0, kMaxTradeCards);
    this.diag.add("comando", `pedido de compra de ${from}: ${offer.item}`);
    this.p.shell.setTradeCards?.(this.trades.length);
    this.broadcast();
  }

  /** A card button: one chat line to the buyer (invite, trade, thanks...), or close the card. */
  async tradeAction(id: string, action: TradeAction): Promise<void> {
    const card = this.trades.find((t) => t.id === id);
    if (!card) return;
    const who = card.from;
    const text: Record<TradeAction, string | null> = {
      invite: `/invite ${who}`,
      trade: `/tradewith ${who}`,
      thanks: `@${who} ty, gl!`,
      sold: `@${who} sorry, it's already sold`,
      kick: `/kick ${who}`,
      dismiss: null,
    };
    const line = text[action];
    if (line && this.p.sendChat) {
      try {
        await this.p.sendChat(line);
        this.diag.add("comando", line);
      } catch (e) {
        this.diag.add("comando", `${line} não enviado: ${e instanceof Error ? e.message : String(e)}`);
        this.broadcast();
        return;
      }
    }
    // these end the deal: the card goes away
    if (action === "thanks" || action === "sold" || action === "kick" || action === "dismiss") {
      this.trades = this.trades.filter((t) => t.id !== id);
      this.p.shell.setTradeCards?.(this.trades.length);
    }
    this.broadcast();
  }

  closePricePopup(): void {
    this.p.shell.hidePricePopup?.();
  }

  /** One key press = one chat line. */
  private async runCommand(key: string): Promise<void> {
    const cmd = (cleanChatCommands(this.config.chatCommands) ?? []).find((c) => c.key === key);
    if (!cmd || !this.p.sendChat) return;
    const text = expandCommand(cmd.text, this.lastWhisper);
    if (!text) {
      this.diag.add("comando", `${key}: ninguém te sussurrou ainda, comando ignorado`);
    } else {
      try {
        await this.p.sendChat(text);
        this.diag.add("comando", `${key}: ${text}`);
      } catch (e) {
        this.diag.add("comando", `${key} não enviado: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.broadcast();
  }

  // ---- overlay / tray ----------------------------------------------------------------------

  private applyOverlayVisibility(): void {
    if (!this.ready) return;
    const cfg = this.config;
    // hidden while the game is in the background (alt-tab), except while the user is
    // interacting with the overlay itself (F10)
    const followFocus = cfg.overlayHideUnfocused && !this.overlayInteractive;
    const show = cfg.overlayEnabled && (!followFocus || this.gameFocused);
    const sh = this.p.shell;
    if (show !== sh.overlayVisible) {
      sh.setOverlayVisible(show);
      this.diag.add("overlay", show ? "overlay visível" : `overlay escondido (${!cfg.overlayEnabled ? "desligado (F9)" : "jogo sem foco ou fechado"})`);
    }
  }

  toggleOverlay(): void {
    this.setConfig({ overlayEnabled: !this.config.overlayEnabled });
  }

  toggleOverlayInteractive(): void {
    this.overlayInteractive = !this.overlayInteractive;
    this.p.shell.setOverlayInteractive(this.overlayInteractive);
    this.applyOverlayVisibility();
    this.broadcast();
  }

  private updateTray(): void {
    if (!this.ready) return;
    const area = this.session.areaName;
    this.p.shell.updateTray({
      tooltip: `Exile Hub${area ? ` — ${area}` : ""}`,
      overlayEnabled: this.config.overlayEnabled,
      priceCheckEnabled: this.config.priceCheckEnabled,
      showDashboardOnGameStart: this.config.showDashboardOnGameStart,
      startWithWindows: this.startWithWindowsCache,
    });
  }

  async setStartWithWindows(on: boolean): Promise<void> {
    await this.p.shell.setStartWithWindows(on);
    this.startWithWindowsCache = await this.p.shell.startWithWindows().catch(() => on);
    this.updateTray();
    this.broadcast();
  }

  // ---- route -----------------------------------------------------------------------------

  private routeChanged(): void {
    this.scheduleSave();
    this.broadcast();
  }
  routeNext(): void {
    this.session.tracker.nextBlock();
    this.routeChanged();
  }
  routePrev(): void {
    this.session.tracker.prevBlock();
    this.routeChanged();
  }
  routeReset(): void {
    this.session.reset();
    this.routeChanged();
  }
  routeSync(): boolean {
    const id = this.session.areaId;
    const ok = id ? this.session.tracker.syncTo(id) : false;
    this.routeChanged();
    return ok;
  }

  // ---- requests from the windows -----------------------------------------------------------

  listDisplays(): Promise<DisplayInfo[]> {
    return this.p.shell.listDisplays();
  }
  async moveDashboard(id: number, fullscreen: boolean): Promise<void> {
    await this.p.shell.moveDashboard(id, fullscreen);
    this.setConfig({ dashboardDisplayId: id, dashboardFullscreen: fullscreen });
  }
  priceResearch(patch: PriceSearchPatch): void {
    this.prices.research(patch);
  }
  priceOpenTrade(): void {
    this.prices.openItemTrade();
  }
  openMapTrade(o: MapTradeOptions): Promise<{ ok: boolean; total?: number; missing: string[]; error?: string }> {
    return this.prices.openMapTrade(o);
  }
  farmPrices(): Promise<FarmPricesResult> {
    return this.prices.farmPrices();
  }
  /** The player says who is playing (the log only names a character on level-ups and deaths). */
  setCharacter(name: string): void {
    if (!this.log.characters.has(name)) return;
    this.session.identify(name);
    this.diag.add("personagem", `personagem escolhido no painel: ${name}`);
    this.scheduleSave();
    this.broadcast();
  }

  getTreeLayout(): Promise<TreeLayout | null> {
    return this.tree.layout();
  }
  getChallenges(): Promise<ChallengesView> {
    return this.challenges.get();
  }
  refreshChallenges(): Promise<ChallengesView> {
    return this.challenges.refresh();
  }
  setChallenge(id: string, done: boolean, part: number | null): Promise<ChallengesView> {
    return this.challenges.set(id, done, part);
  }
  installUpdate(): void {
    this.p.shell.installUpdate();
  }

  /**
   * "Reportar problema": copies the diagnostic report and opens a new GitHub issue, where the player
   * pastes it (nothing is sent by the app itself).
   */
  async reportProblem(): Promise<void> {
    await this.copyDiagReport();
    this.p.openExternal(`${kIssuesUrl}?title=${encodeURIComponent(`Problema na versão ${this.p.appVersion}`)}`);
  }

  /** Copies a plain-text report (status + the whole event list) for the owner to paste in a chat. */
  async copyDiagReport(): Promise<void> {
    const s = this.state();
    const ago = (ts: number | null) => (ts ? `${Math.round((Date.now() - ts) / 1000)} s atrás` : "nunca");
    const c = this.config;
    const header = [
      `versão ${this.p.appVersion} · ${this.p.packaged ? "instalado" : "desenvolvimento"} · ${new Date().toLocaleString("pt-BR")}`,
      `Client.txt: ${c.clientLogPath ?? "(nenhum)"} · ${s.logStatus} · última linha ${ago(this.diag.lastLineAt)} · ${this.diag.linesSeen} linhas nesta sessão`,
      `jogo: ${this.gameRunning ? "aberto" : "fechado/desconhecido"} · foco: ${this.gameFocused ? "sim" : "não"} · overlay: ${s.diag.overlayVisible ? "visível" : "escondido"} (ativado: ${c.overlayEnabled}, esconder sem foco: ${c.overlayHideUnfocused})`,
      `personagem: ${s.characterName ?? "?"} (${s.className ?? "?"}, nível ${s.characterLevel ?? "?"}) · zona: ${s.areaName ?? "?"} (${s.areaId ?? "?"}) · rota ${s.tracker.cursor}/${s.tracker.total}`,
      `liga: ${s.league ?? "?"} · price check: ${c.priceCheckEnabled ? "ligado" : "desligado"} · build: ${s.build ? `${s.build.className}/${s.build.ascendClass}` : "nenhum"} · árvore: ${s.tree?.status ?? "-"}`,
      `mapa atual: ${s.maps.current ? `${s.maps.current.name} T${s.maps.current.tier}` : "-"} · mapas hoje: ${s.maps.today?.maps ?? 0}`,
    ];
    await this.prices.writeClipboard(this.diag.report(header));
    this.diag.add("app", "relatório copiado para a área de transferência");
    this.broadcast();
  }

  // ---- state -------------------------------------------------------------------------------

  /** The build's main link (the enabled group with most gems) and its socket colors, for vendor searches. */
  private buildLinks(): AppState["buildLinks"] {
    const b = this.build;
    if (!b) return null;
    const groups = b.groups.filter((g) => g.enabled && g.gems.some((x) => x.enabled));
    const main = [...groups].sort((x, y) => y.gems.filter((g) => g.enabled).length - x.gems.filter((g) => g.enabled).length)[0];
    if (!main) return null;
    const byName = new Map(Object.values(this.gemsData).map((g) => [g.name, g]));
    const attrOf = (n: string) => (byName.get(n) ?? byName.get(`${n} Support`))?.primary_attribute;
    const names = main.gems.filter((g) => g.enabled).map((g) => g.name);
    return { label: main.label, gems: names, colors: gemColors(names, attrOf) };
  }

  private farmRuns(): AppState["farmRuns"] {
    const out: AppState["farmRuns"] = {};
    for (const [boss, s] of this.log.bossRuns.stats()) {
      out[boss] = { runs: s.runs, minutes: measuredMinutes(s), fightSec: s.fightSec, deaths: s.deaths, lastRunAt: s.lastRunAt };
    }
    return out;
  }

  /** Set by the platform: its update status (electron-updater / Tauri updater). */
  updateState: AppState["update"] = { status: "disabled", current: "", version: null, progress: null, message: null };

  state(): AppState {
    const c = this.config;
    return {
      config: c,
      logStatus: this.log.error ? "error" : !c.clientLogPath ? "no-path" : this.log.fileSeen ? "watching" : "waiting",
      logError: this.log.error,
      areaId: this.session.areaId,
      areaName: this.session.areaName,
      characterName: this.session.characterName,
      className: this.session.className,
      characterLevel: this.session.characterLevel,
      tracker: this.session.tracker.view(),
      timers: this.session.timer.snapshot(Date.now()),
      build: this.build,
      overlayInteractive: this.overlayInteractive,
      price: this.prices.view,
      priceRecent: this.prices.recent,
      buildInfo: this.buildInfo,
      startWithWindows: this.startWithWindowsCache,
      farmRuns: this.farmRuns(),
      tree: this.tree.state(this.build, this.session, this.log.passives),
      maps: this.log.maps.stats(),
      diag: {
        entries: this.diag.recent(),
        lastLineAt: this.diag.lastLineAt,
        linesSeen: this.diag.linesSeen,
        gameRunning: this.gameRunning,
        gameFocused: this.gameFocused,
        overlayVisible: this.p.shell.overlayVisible,
        clipboardWatch: this.prices.watching,
        version: this.p.appVersion,
      },
      update: { ...this.updateState, current: this.updateState.current || this.p.appVersion },
      sessions: {
        current: this.log.sessions.current ? sessionView(this.log.sessions.current, this.prices.history) : null,
        recent: this.log.sessions
          .recent(12)
          .filter((s) => s.end !== null)
          .map((s) => sessionView(s, this.prices.history)),
      },
      buildLinks: this.buildLinks(),
      endgame: this.session.endgame,
      trades: this.trades,
      knownCharacters: [...this.log.characters]
        .sort((a, b) => (b[1].ts ?? 0) - (a[1].ts ?? 0))
        .map(([name, c]) => ({ name, className: c.className, level: c.level })),
      chat: {
        supported: !!this.p.setCommandKeys && !!this.p.sendChat,
        active: this.commandKeys !== "",
        lastWhisper: this.lastWhisper,
      },
      league: this.prices.league(),
      leagues: this.prices.leagues,
    };
  }

  broadcast(): void {
    // nothing to send before the windows exist
    if (!this.ready || !this.p.shell.windowsReady) return;
    // buy requests nobody acted on go away after a while
    if (this.trades.some((t) => Date.now() - t.at >= kTradeCardMs)) {
      this.trades = this.trades.filter((t) => Date.now() - t.at < kTradeCardMs);
      this.p.shell.setTradeCards?.(this.trades.length);
    }
    this.p.shell.send(this.state());
  }

  async shutdown(): Promise<void> {
    await this.saveProgress();
    this.log.stop();
  }
}

/** A session for the screen; price checks are the app's own (only sessions while it ran have them). */
function sessionView(s: GameSession, prices: { ts: number; name: string; chaos: number | null }[]): AppState["sessions"]["recent"][number] {
  const end = s.end ?? Date.now();
  const priced = prices.filter((p) => p.ts >= s.start && p.ts <= end);
  const best = priced.reduce<(typeof priced)[number] | null>((b, p) => (p.chaos !== null && (!b || (b.chaos ?? 0) < p.chaos) ? p : b), null);
  return {
    start: s.start,
    end: s.end,
    durationMs: sessionDurationMs(s),
    abrupt: s.abrupt,
    characters: Object.entries(s.characters).map(([name, c]) => ({ name, className: c.className, from: c.fromLevel, to: c.toLevel })),
    deaths: s.deaths,
    maps: s.maps,
    bossRuns: s.bossRuns,
    zones: s.zones,
    passives: s.passives,
    priceChecks: priced.length,
    bestPrice: best && best.chaos !== null ? { name: best.name, chaos: best.chaos } : null,
  };
}

/** The build's items; a build without items (or an odd export) just has nothing to compare with. */
function equippedOf(code: string): EquippedItem[] {
  try {
    return importPobEquipped(code);
  } catch {
    return [];
  }
}
