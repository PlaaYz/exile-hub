// Exile Hub main process: wires the services together and owns what they share (settings, the
// play session, the build) and the app state sent to the windows.
//   env.ts         constants, paths, HTTP, icon        logService.ts  Client.txt + history trackers
//   config.ts      settings file                        priceService.ts clipboard, prices, trade
//   ipcClean.ts    renderer input validation           gemAdvice.ts   support gems (PoB engine)
//   ipc.ts         IPC handlers                         treeService.ts passive tree vs build
//   diagnostics.ts Diagnóstico tab                      windows.ts     dashboard, overlay, tray
import { app, globalShortcut, session as electronSession } from "electron";
import fs from "node:fs";
import path from "node:path";
import { measuredMinutes } from "../core/bossRuns";
import { parseLine, type LogEvent } from "../core/clientLog";
import { describeEvent, type DiagKind } from "../core/diag";
import type { GemInfo, QuestInfo } from "../core/gemAvailability";
import { applyGemLevels, gemLevelTable, importPob, pobSourceUrl } from "../core/pob";
import type { Lookups } from "../core/route";
import { gemColors } from "../core/searchRegex";
import { Session, type ProgressData } from "../core/session";
import { sessionDurationMs, type GameSession } from "../core/gameSessions";
import type { ImportResult } from "../shared/ipc";
import type { AppConfig, AppState, PobBuild } from "../shared/types";
import { ConfigStore } from "./config";
import { Diagnostics } from "./diagnostics";
import {
  dataDir,
  isDev,
  kOverlayInteractKey,
  kOverlayToggleKey,
  kPobFetchTimeoutMs,
  kProgressSaveMs,
  kStateBroadcastMs,
  readJson,
  userFile,
} from "./env";
import { GemAdviceService } from "./gemAdvice";
import { registerIpc, type IpcTarget } from "./ipc";
import { LogService } from "./logService";
import { PriceService } from "./priceService";
import { TreeService } from "./treeService";
import { Updater } from "./updater";
import { Windows } from "./windows";

class Hub implements IpcTarget {
  private readonly cfg = new ConfigStore();
  private readonly lookups: Lookups;
  private readonly gemsData: Record<string, GemInfo>;
  private readonly gemLevels: Map<string, number>;
  private readonly session: Session;
  private build: PobBuild | null = null;
  private buildInfo: AppState["buildInfo"] = null;
  /** from "[WINDOW] Gained/Lost focus" in Client.txt; unknown at start = treat as focused */
  private gameFocused = true;
  /** game process running, as far as the log tells (closing line / new log session) */
  private gameRunning = false;
  private readonly progressFile = userFile("progress.json");
  private readonly buildFile = userFile("build.json");
  private saveTimer: NodeJS.Timeout | null = null;

  readonly diag = new Diagnostics();
  readonly windows: Windows;
  readonly log: LogService;
  readonly prices: PriceService;
  readonly gems: GemAdviceService;
  private readonly tree: TreeService;
  readonly updater: Updater;

  constructor() {
    this.lookups = {
      areas: readJson(path.join(dataDir, "json/areas.json")),
      quests: readJson(path.join(dataDir, "json/quests.json")),
    };
    this.gemsData = readJson(path.join(dataDir, "json/gems.json"));
    this.gemLevels = gemLevelTable(this.gemsData);
    const routeTexts = Array.from({ length: 10 }, (_, i) => fs.readFileSync(path.join(dataDir, `routes/act-${i + 1}.txt`), "utf8"));
    this.cfg.load();
    this.session = new Session(this.lookups, routeTexts, this.config.leagueStart);

    const addDiag = (kind: DiagKind, text: string) => this.diag.add(kind, text);
    const broadcast = () => this.broadcast();
    const config = () => this.config;
    this.windows = new Windows({
      config,
      setConfig: (p) => this.setConfig(p),
      gameFocused: () => this.gameFocused,
      areaName: () => this.session.areaName,
      addDiag,
      broadcast,
    });
    this.log = new LogService({
      onEvent: (ev) => this.onEvent(ev),
      onParsed: (ev) => {
        const d = describeEvent(ev, (id) => this.lookups.areas[id]);
        if (d) this.diag.add(d.kind, d.text);
      },
      onRawLine: () => this.diag.lineSeen(),
      onScanDone: (lastLevelUp) => this.onScanDone(lastLevelUp),
      addDiag,
      broadcast,
      // campaign zones only ("1_1_2"...), acts 1-10: hideouts and the endgame town do not count
      actOf: (id) => {
        const act = /^\d_\d+_/.test(id) ? this.lookups.areas[id]?.act : undefined;
        return act && act <= 10 ? act : null;
      },
    });
    this.prices = new PriceService({
      config,
      broadcast,
      addDiag,
      onPobText: (text) => {
        this.diag.add("clipboard", "código/link do Path of Building copiado: importando");
        void this.importBuild(text, "clipboard").then((r) =>
          this.diag.add("clipboard", r.ok ? "build importado do clipboard" : `não era um build válido (${r.error})`),
        );
      },
    });
    this.gems = new GemAdviceService({
      config,
      session: () => this.session,
      build: () => this.build,
      gemsData: this.gemsData,
      quests: this.lookups.quests as Record<string, QuestInfo>,
      broadcast,
      addDiag,
    });
    this.tree = new TreeService(broadcast);
    this.updater = new Updater({ broadcast, notify: (t, m) => this.windows.notify(t, m) });
    this.loadProgress();
    this.loadBuild();
  }

  get config(): AppConfig {
    return this.cfg.value;
  }

  setConfig(patch: Partial<AppConfig>): void {
    const prev = this.cfg.update(patch);
    if (patch.leagueStart !== undefined && patch.leagueStart !== prev.leagueStart) this.session.rebuild(this.config.leagueStart);
    if (patch.clientLogPath !== undefined && patch.clientLogPath !== prev.clientLogPath) this.startTail();
    if (patch.overlayEnabled !== undefined || patch.overlayHideUnfocused !== undefined) this.windows.applyOverlayVisibility();
    if (patch.priceCheckEnabled !== undefined) this.prices.applyClipboardWatch();
    if (patch.gemAdviceEnabled !== undefined) this.gems.maybeAdvise(true);
    this.windows.updateTray();
    this.broadcast();
  }

  // ---- persistence: route/timers per character, last build -------------------------------

  private loadProgress(): void {
    try {
      this.session.importProgress(readJson<ProgressData>(this.progressFile));
    } catch {
      /* first run */
    }
  }

  saveProgress(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(this.progressFile), { recursive: true });
      fs.writeFileSync(this.progressFile, JSON.stringify(this.session.exportProgress()));
    } catch (e) {
      console.error("could not save progress", e);
    }
  }

  /** Progress changes on every zone: write at most every few seconds. */
  private scheduleSave(): void {
    if (!this.saveTimer) this.saveTimer = setTimeout(() => this.saveProgress(), kProgressSaveMs);
  }

  private loadBuild(): void {
    try {
      const saved = readJson<{ code: string; at: number }>(this.buildFile);
      this.build = applyGemLevels(importPob(saved.code), this.gemLevels);
      this.buildInfo = { source: "saved", at: saved.at };
      this.gems.setBuildCode(saved.code);
    } catch {
      /* no saved build */
    }
  }

  async importBuild(input: string, source: "manual" | "clipboard" = "manual"): Promise<ImportResult> {
    try {
      let code = input.trim();
      const url = pobSourceUrl(code);
      if (url) {
        const res = await fetch(url, { signal: AbortSignal.timeout(kPobFetchTimeoutMs) });
        if (!res.ok) throw new Error(`falha no download (HTTP ${res.status})`);
        code = (await res.text()).trim();
      }
      this.build = applyGemLevels(importPob(code), this.gemLevels);
      const at = Date.now();
      this.buildInfo = { source, at };
      this.gems.setBuildCode(code);
      try {
        fs.writeFileSync(this.buildFile, JSON.stringify({ code, at }));
      } catch (e) {
        console.error("could not save build", e);
      }
      this.broadcast();
      return { ok: true };
    } catch (e) {
      // copied text that only looked like a PoB code: stay quiet
      return { ok: false, error: (e as Error).message };
    }
  }

  // ---- Client.txt ------------------------------------------------------------------------

  detectLog(): string | null {
    return LogService.detect();
  }

  startTail(): void {
    const p = this.config.clientLogPath;
    if (!p) {
      this.log.stop();
      return;
    }
    this.diag.add("app", `lendo ${p}`);
    const tail = this.log.start(p);
    // learn where the player is from the end of the log
    this.session.backfill(tail);
    // is the game focused right now? (last focus line; none = game not started yet)
    for (let i = tail.length - 1; i >= 0; i--) {
      const ev = describeFocus(tail[i]);
      if (ev) {
        this.gameFocused = ev.focused;
        // the app started while the game was already running: no "open the dashboard" later
        this.gameRunning = !ev.closing;
        break;
      }
    }
    this.scheduleSave();
    this.gems.maybeAdvise(); // the log tail may have a newer character than the saved progress
  }

  private onScanDone(lastLevelUp: LogEvent | null): void {
    // the end of the log did not say who is playing: assume the last character that leveled up
    if (!this.session.characterName && lastLevelUp) {
      this.session.apply(lastLevelUp);
      this.gems.maybeAdvise();
      this.scheduleSave();
    }
  }

  /** A live Client.txt event (the history trackers already saw it). */
  private onEvent(ev: LogEvent): void {
    if (ev.type === "focus") {
      if (ev.closing && !ev.opening) this.announceSessionEnd();
      this.gameFocused = ev.focused;
      this.onGameFocus(ev);
      this.windows.applyOverlayVisibility();
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
    if (ev.type === "area") this.windows.updateTray();
    if (ev.type === "levelup" || ev.type === "area") this.gems.maybeAdvise();
  }

  /** From the log: the game opened (focus after a closing) or closed. */
  private onGameFocus(ev: { focused: boolean; closing?: true }): void {
    if (ev.closing) {
      this.gameRunning = false;
      return;
    }
    if (ev.focused && !this.gameRunning) {
      this.gameRunning = true;
      if (this.config.showDashboardOnGameStart) this.windows.showDashboard(false);
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
    this.windows.notify("Sessão encerrada", parts.join(" · "));
    this.diag.add("jogo", `sessão encerrada: ${parts.join(" · ")}`);
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

  // ---- IPC pass-throughs -------------------------------------------------------------------

  dashboardWindow() {
    return this.windows.dashboard;
  }
  listDisplays() {
    return this.windows.listDisplays();
  }
  moveDashboard(id: number, fullscreen: boolean): void {
    this.windows.moveDashboard(id, fullscreen);
  }
  toggleOverlay(): void {
    this.windows.toggleOverlay();
  }
  toggleOverlayInteractive(): void {
    this.windows.toggleOverlayInteractive();
  }
  setStartWithWindows(on: boolean): void {
    this.windows.setStartWithWindows(on);
  }
  priceResearch(patch: { statId: string; enabled: boolean; min: number | null }[]): void {
    this.prices.research(patch);
  }
  priceOpenTrade(): void {
    this.prices.openItemTrade();
  }
  openMapTrade(o: Parameters<PriceService["openMapTrade"]>[0]) {
    return this.prices.openMapTrade(o);
  }
  farmPrices() {
    return this.prices.farmPrices();
  }
  refreshGemAdvice(): void {
    this.gems.maybeAdvise(true);
  }
  installUpdate(): void {
    this.windows.quitting = true;
    this.updater.installNow();
  }

  /** Copies a plain-text report (status + the whole event list) for the owner to paste in a chat. */
  copyDiagReport(): void {
    const s = this.state();
    const ago = (ts: number | null) => (ts ? `${Math.round((Date.now() - ts) / 1000)} s atrás` : "nunca");
    const c = this.config;
    const header = [
      `versão ${app.getVersion()} · ${app.isPackaged ? "executável" : "desenvolvimento"} · ${new Date().toLocaleString("pt-BR")}`,
      `Client.txt: ${c.clientLogPath ?? "(nenhum)"} · ${s.logStatus} · última linha ${ago(this.diag.lastLineAt)} · ${this.diag.linesSeen} linhas nesta sessão`,
      `jogo: ${this.gameRunning ? "aberto" : "fechado/desconhecido"} · foco: ${this.gameFocused ? "sim" : "não"} · overlay: ${s.diag.overlayVisible ? "visível" : "escondido"} (ativado: ${c.overlayEnabled}, esconder sem foco: ${c.overlayHideUnfocused})`,
      `personagem: ${s.characterName ?? "?"} (${s.className ?? "?"}, nível ${s.characterLevel ?? "?"}) · zona: ${s.areaName ?? "?"} (${s.areaId ?? "?"}) · rota ${s.tracker.cursor}/${s.tracker.total}`,
      `liga: ${s.league ?? "?"} · price check: ${c.priceCheckEnabled ? "ligado" : "desligado"} · build: ${s.build ? `${s.build.className}/${s.build.ascendClass}` : "nenhum"} · árvore: ${s.tree?.status ?? "-"}`,
      `mapa atual: ${s.maps.current ? `${s.maps.current.name} T${s.maps.current.tier}` : "-"} · mapas hoje: ${s.maps.today?.maps ?? 0}`,
    ];
    this.prices.writeClipboard(this.diag.report(header));
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
      overlayInteractive: this.windows.overlayInteractive,
      price: this.prices.view,
      buildInfo: this.buildInfo,
      startWithWindows: this.windows.startWithWindows(),
      farmRuns: this.farmRuns(),
      tree: this.tree.state(this.build, this.session, this.log.passives),
      maps: this.log.maps.stats(),
      diag: {
        entries: this.diag.recent(),
        lastLineAt: this.diag.lastLineAt,
        linesSeen: this.diag.linesSeen,
        gameRunning: this.gameRunning,
        gameFocused: this.gameFocused,
        overlayVisible: this.windows.overlayVisible,
        clipboardWatch: this.prices.watching,
        version: app.getVersion(),
      },
      gemAdvice: this.gems.state,
      update: this.updater.state,
      sessions: {
        current: this.log.sessions.current ? sessionView(this.log.sessions.current, this.prices.history) : null,
        recent: this.log.sessions
          .recent(12)
          .filter((s) => s.end !== null)
          .map((s) => sessionView(s, this.prices.history)),
      },
      buildLinks: this.buildLinks(),
      league: this.prices.league(),
      leagues: this.prices.leagues,
    };
  }

  broadcast(): void {
    // nothing to send before the windows exist (also guards calls made from constructors)
    if (!this.windows?.any) return;
    this.windows.send(this.state());
  }

  shutdown(): void {
    globalShortcut.unregisterAll();
    this.saveProgress();
    this.gems.stop();
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

/** Focus / closing lines only (startup scan of the log tail). */
function describeFocus(line: string): { focused: boolean; closing?: true } | null {
  const ev = parseLine(line);
  return ev?.type === "focus" ? ev : null;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let hubRef: Hub | null = null;
  // a second launch (desktop shortcut, autostart) just brings the running app forward
  app.on("second-instance", () => hubRef?.windows.showDashboard());
  app.on("before-quit", () => {
    if (hubRef) hubRef.windows.quitting = true; // Windows shutdown / sign-out: really quit
  });
  void app.whenReady().then(() => {
    if (!isDev) {
      electronSession.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        cb({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [
              "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'",
            ],
          },
        });
      });
    }

    const hub = new Hub();
    hubRef = hub;
    if (!hub.config.clientLogPath) {
      const found = hub.detectLog();
      if (found) hub.setConfig({ clientLogPath: found });
    } else {
      hub.startTail();
    }
    registerIpc(hub);
    // started by Windows at login: stay in the tray until the game opens
    hub.windows.createDashboard(process.argv.includes("--hidden"));
    hub.windows.createOverlay();
    hub.windows.createTray();
    void hub.prices.loadLeagues();
    hub.prices.applyClipboardWatch();
    hub.updater.start();

    globalShortcut.register(kOverlayToggleKey, () => hub.toggleOverlay());
    globalShortcut.register(kOverlayInteractKey, () => hub.toggleOverlayInteractive());
    setInterval(() => hub.broadcast(), kStateBroadcastMs);
    app.on("will-quit", () => hub.shutdown());
  });
}

// windows only close on "Sair" (they hide otherwise), so this is the real end
app.on("window-all-closed", () => app.quit());
