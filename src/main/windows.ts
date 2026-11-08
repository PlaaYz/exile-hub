// The dashboard, the in-game overlay, the tray icon and the Windows integration (login item,
// monitors). Knows nothing about the game: it asks the Hub through WindowsContext.
import { app, BrowserWindow, Menu, screen, Tray, type WebPreferences } from "electron";
import type { DiagKind } from "../core/diag";
import { CH } from "../shared/ipc";
import type { AppConfig, AppState, DisplayInfo } from "../shared/types";
import { appIcon, isDev, kOverlayMargin, kOverlaySize, preloadPath, rendererIndex } from "./env";

type Mode = "dashboard" | "overlay";

export interface WindowsContext {
  config(): AppConfig;
  setConfig(patch: Partial<AppConfig>): void;
  /** game focus as seen in Client.txt */
  gameFocused(): boolean;
  /** "Exile Hub — <zone>" in the tray tooltip */
  areaName(): string | null;
  addDiag(kind: DiagKind, text: string): void;
  broadcast(): void;
}

export class Windows {
  dashboard: BrowserWindow | null = null;
  overlay: BrowserWindow | null = null;
  overlayInteractive = false;
  quitting = false;
  private tray: Tray | null = null;
  private trayNotified = false;

  constructor(private readonly ctx: WindowsContext) {}

  /** Sends the app state to every window. */
  send(state: AppState): void {
    for (const w of [this.dashboard, this.overlay]) {
      if (w && !w.isDestroyed()) w.webContents.send(CH.state, state);
    }
  }

  get any(): boolean {
    return !!this.dashboard || !!this.overlay;
  }

  get overlayVisible(): boolean {
    return !!this.overlay && !this.overlay.isDestroyed() && this.overlay.isVisible();
  }

  private loadRenderer(win: BrowserWindow, mode: Mode): void {
    if (isDev) void win.loadURL(`${process.env.VITE_DEV_URL}/index.html?mode=${mode}`);
    else void win.loadFile(rendererIndex, { query: { mode } });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
  }

  private webPrefs(): WebPreferences {
    return { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true };
  }

  // ---- dashboard ----------------------------------------------------------------------

  createDashboard(hidden = false): void {
    const win = new BrowserWindow({
      width: 1180,
      height: 780,
      minWidth: 640,
      minHeight: 420,
      backgroundColor: "#0e1116",
      title: "Exile Hub",
      icon: appIcon(),
      autoHideMenuBar: true,
      show: !hidden,
      webPreferences: this.webPrefs(),
    });
    this.dashboard = win;
    this.loadRenderer(win, "dashboard");
    // closing the window keeps the app in the tray (log tracking, overlay and price check go on);
    // "Sair" in the tray menu quits
    win.on("close", (e) => {
      if (this.quitting) return;
      e.preventDefault();
      win.hide();
      this.notifyTrayOnce();
    });
    win.on("closed", () => (this.dashboard = null));
    // Default to the secondary monitor (the game stays on the primary one).
    const cfg = this.ctx.config();
    const target = cfg.dashboardDisplayId ?? this.secondaryDisplayId();
    if (target !== null) this.moveDashboard(target, cfg.dashboardFullscreen, false);
    if (hidden) win.hide(); // moveDashboard may have shown it (fullscreen)
  }

  /** Bring the dashboard back (tray click, second launch, game start). */
  showDashboard(steal = true): void {
    if (!this.dashboard || this.dashboard.isDestroyed()) this.createDashboard();
    const w = this.dashboard!;
    if (w.isMinimized()) w.restore();
    if (steal) {
      w.show();
      w.focus();
    } else if (!w.isVisible()) {
      w.showInactive(); // the game keeps the keyboard
    }
  }

  private secondaryDisplayId(): number | null {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().find((d) => d.id !== primaryId)?.id ?? null;
  }

  listDisplays(): DisplayInfo[] {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `Monitor ${i + 1}${d.label ? ` (${d.label})` : ""}`,
      width: d.size.width,
      height: d.size.height,
      primary: d.id === primaryId,
    }));
  }

  moveDashboard(displayId: number, fullscreen: boolean, persist = true): void {
    const win = this.dashboard;
    if (!win || win.isDestroyed()) return;
    const d = screen.getAllDisplays().find((x) => x.id === displayId);
    if (!d) return;
    if (win.isFullScreen()) win.setFullScreen(false);
    const wa = d.workArea;
    const w = Math.min(1180, wa.width);
    const h = Math.min(780, wa.height);
    win.setBounds({ x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + Math.round((wa.height - h) / 2), width: w, height: h });
    if (fullscreen) win.setFullScreen(true);
    if (persist) this.ctx.setConfig({ dashboardDisplayId: displayId, dashboardFullscreen: fullscreen });
  }

  // ---- overlay --------------------------------------------------------------------------

  createOverlay(): void {
    const primary = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      x: primary.x + kOverlayMargin,
      y: primary.y + kOverlayMargin,
      width: kOverlaySize.width,
      height: kOverlaySize.height,
      transparent: true,
      frame: false,
      resizable: false,
      hasShadow: false,
      skipTaskbar: true,
      focusable: false, // never steal focus from the game
      alwaysOnTop: true,
      show: false,
      webPreferences: this.webPrefs(),
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setIgnoreMouseEvents(true, { forward: true });
    this.overlay = win;
    this.loadRenderer(win, "overlay");
    win.on("closed", () => (this.overlay = null));
    win.once("ready-to-show", () => this.applyOverlayVisibility());
  }

  applyOverlayVisibility(): void {
    const w = this.overlay;
    if (!w || w.isDestroyed()) return;
    const cfg = this.ctx.config();
    // hidden while the game is in the background (alt-tab), except while the user is
    // interacting with the overlay itself (F10)
    const followFocus = cfg.overlayHideUnfocused && !this.overlayInteractive;
    const show = cfg.overlayEnabled && (!followFocus || this.ctx.gameFocused());
    if (show && !w.isVisible()) {
      w.showInactive();
      this.ctx.addDiag("overlay", "overlay visível");
    } else if (!show && w.isVisible()) {
      w.hide();
      this.ctx.addDiag("overlay", `overlay escondido (${!cfg.overlayEnabled ? "desligado (F9)" : "jogo sem foco ou fechado"})`);
    }
  }

  toggleOverlay(): void {
    this.ctx.setConfig({ overlayEnabled: !this.ctx.config().overlayEnabled });
  }

  toggleOverlayInteractive(): void {
    const w = this.overlay;
    if (!w || w.isDestroyed()) return;
    this.overlayInteractive = !this.overlayInteractive;
    if (this.overlayInteractive) w.setIgnoreMouseEvents(false);
    else w.setIgnoreMouseEvents(true, { forward: true });
    this.applyOverlayVisibility();
    this.ctx.broadcast();
  }

  // ---- tray ---------------------------------------------------------------------------

  createTray(): void {
    this.tray = new Tray(appIcon());
    this.tray.on("click", () => this.showDashboard());
    this.updateTray();
  }

  /** A Windows notification from the tray icon (e.g. the session summary). */
  notify(title: string, content: string): void {
    if (!this.tray || this.tray.isDestroyed()) return;
    this.tray.displayBalloon({ title, content, iconType: "info" });
  }

  private notifyTrayOnce(): void {
    if (this.trayNotified || !this.tray) return;
    this.trayNotified = true;
    this.tray.displayBalloon({
      title: "Exile Hub continua rodando",
      content: "O overlay, o price check e o acompanhamento do jogo seguem ativos. Para sair, use o ícone na bandeja.",
      iconType: "info",
    });
  }

  updateTray(): void {
    const t = this.tray;
    if (!t || t.isDestroyed()) return;
    const cfg = this.ctx.config();
    const area = this.ctx.areaName();
    t.setToolTip(`Exile Hub${area ? ` — ${area}` : ""}`);
    t.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Abrir painel", click: () => this.showDashboard() },
        { type: "separator" },
        { label: "Overlay no jogo (F9)", type: "checkbox", checked: cfg.overlayEnabled, click: () => this.toggleOverlay() },
        {
          label: "Price check (Ctrl+C no item)",
          type: "checkbox",
          checked: cfg.priceCheckEnabled,
          click: () => this.ctx.setConfig({ priceCheckEnabled: !this.ctx.config().priceCheckEnabled }),
        },
        {
          label: "Abrir o painel quando o jogo abrir",
          type: "checkbox",
          checked: cfg.showDashboardOnGameStart,
          click: () => this.ctx.setConfig({ showDashboardOnGameStart: !this.ctx.config().showDashboardOnGameStart }),
        },
        {
          label: "Iniciar com o Windows",
          type: "checkbox",
          checked: this.startWithWindows(),
          click: () => this.setStartWithWindows(!this.startWithWindows()),
        },
        { type: "separator" },
        {
          label: "Sair",
          click: () => {
            this.quitting = true;
            app.quit();
          },
        },
      ]),
    );
  }

  // ---- Windows login item -------------------------------------------------------------

  /** The portable exe when packaged, electron + project folder in development. */
  private loginItem(): { path: string; args: string[] } {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    return { path: exe, args: app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"] };
  }

  startWithWindows(): boolean {
    return app.getLoginItemSettings(this.loginItem()).openAtLogin;
  }

  setStartWithWindows(on: boolean): void {
    app.setLoginItemSettings({ openAtLogin: on, ...this.loginItem() });
    this.updateTray();
    this.ctx.broadcast();
  }
}
