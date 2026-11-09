// Windows, tray and Windows integration on Tauri. The dashboard webview (where the app runs) drives
// both windows; the overlay only receives the state.
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { emitTo, listen } from "@tauri-apps/api/event";
import { Menu } from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import { availableMonitors, getCurrentWindow, primaryMonitor, Window, type Monitor } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { sendNotification } from "@tauri-apps/plugin-notification";
import type { Shell, TrayState } from "../app/platform";
import type { AppConfig, AppState, DisplayInfo } from "../shared/types";
import type { TauriUpdater } from "./tauriUpdater";

const kDashboardSize = { width: 1180, height: 780 };
const kOverlayMargin = 24;
/** How long the hidden overlay window is kept after the game closed (memory). */
const kOverlayKeepMs = 5 * 60 * 1000;

/** What the tray menu needs from the app. */
export interface ShellContext {
  config(): AppConfig;
  setConfig(patch: Partial<AppConfig>): void;
  toggleOverlay(): void;
  setStartWithWindows(on: boolean): void;
  /** save progress before the process ends */
  beforeQuit(): Promise<void>;
}

/** Monitors have no numeric id on Tauri: a stable hash of the name. */
function monitorId(m: Monitor): number {
  let h = 5381;
  for (const c of m.name ?? "") h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h;
}

export class TauriShell implements Shell {
  windowsReady = false;
  overlayVisible = false;
  ctx: ShellContext | null = null;
  readonly stateListeners = new Set<(s: AppState) => void>();
  private readonly dashboard = getCurrentWindow();
  private overlay: Window | null = null;
  private overlayReady: Promise<void> | null = null;
  private overlayCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private overlayInteractive = false;
  private overlayMoveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastState: AppState | null = null;
  private dashboardShown = true;
  private tray: TrayIcon | null = null;
  private trayKey = "";
  private trayNotified = false;

  async init(hidden: boolean): Promise<void> {
    // the dashboard draws nothing while hidden in the tray; catch up when it shows again.
    // document.hidden alone is not enough: a window never shown (--hidden) still reports "visible"
    this.dashboardShown = !hidden;
    document.addEventListener("visibilitychange", () => this.catchUp());
    await listen("dashboard-shown", () => {
      this.dashboardShown = true;
      this.catchUp();
    });
    // default to the secondary monitor (the game stays on the primary one)
    const primary = await primaryMonitor();
    const cfg = this.ctx?.config();
    const monitors = await availableMonitors();
    const target = monitors.find((m) => monitorId(m) === cfg?.dashboardDisplayId) ?? monitors.find((m) => m.name !== primary?.name);
    if (target) await this.place(target, cfg?.dashboardFullscreen ?? false);
    if (!hidden) await invoke("window_show", { label: "dashboard", activate: true });

    this.tray = await TrayIcon.new({
      id: "main",
      icon: (await defaultWindowIcon()) ?? undefined,
      tooltip: "Exile Hub",
      showMenuOnLeftClick: false,
      action: (e) => {
        if (e.type === "Click" && e.button === "Left" && e.buttonState === "Up") this.showDashboard(true);
      },
    });
    await listen("dashboard-hidden", () => {
      this.dashboardShown = false;
      if (this.trayNotified) return;
      this.trayNotified = true;
      this.notify(
        "Exile Hub continua rodando",
        "O overlay, o price check e o acompanhamento do jogo seguem ativos. Para sair, use o ícone na bandeja.",
      );
    });
    this.windowsReady = true;
  }

  send(state: AppState): void {
    this.lastState = state;
    if (this.drawing) for (const l of this.stateListeners) l(state);
    if (this.overlayVisible && this.overlay) void emitTo("overlay", "state", state);
    if (this.priceVisible) void emitTo("price", "state", state);
  }

  // ---- price popup (Ctrl+D) -------------------------------------------------------------------

  private priceVisible = false;
  private priceReady: Promise<Window | null> | null = null;

  private ensurePrice(): Promise<Window | null> {
    this.priceReady ??= (async () => {
      await invoke("window_open", { label: "price" });
      return Window.getByLabel("price");
    })().catch((e: unknown) => {
      this.priceReady = null;
      console.error("could not open the price window", e);
      return null;
    });
    return this.priceReady;
  }

  /** Next to the mouse (the item being checked), kept inside that monitor, focused for Esc/filters. */
  async showPricePopup(): Promise<void> {
    const w = await this.ensurePrice();
    if (!w) return;
    const [cx, cy] = await invoke<[number, number]>("cursor_pos");
    const monitors = await availableMonitors();
    const m =
      monitors.find((x) => cx >= x.position.x && cy >= x.position.y && cx < x.position.x + x.size.width && cy < x.position.y + x.size.height) ??
      (await primaryMonitor());
    const size = await w.outerSize();
    if (m) {
      const wa = m.workArea ?? { position: m.position, size: m.size };
      const gap = Math.round(24 * m.scaleFactor);
      // right of the mouse when it fits, else left of it
      let x = cx + gap;
      if (x + size.width > wa.position.x + wa.size.width) x = cx - gap - size.width;
      x = Math.max(wa.position.x, x);
      const y = Math.min(Math.max(wa.position.y, cy - Math.round(size.height / 3)), wa.position.y + wa.size.height - size.height);
      await w.setPosition(new PhysicalPosition(x, y));
    }
    this.priceVisible = true;
    if (this.lastState) void emitTo("price", "state", this.lastState);
    await invoke("window_show", { label: "price", activate: true });
  }

  /** Hide it and give the keyboard back to the game. */
  hidePricePopup(): void {
    if (!this.priceVisible) return;
    this.priceVisible = false;
    void invoke("window_hide", { label: "price" }).then(() => invoke("focus_game"));
  }

  private get drawing(): boolean {
    return this.dashboardShown && !document.hidden;
  }

  private catchUp(): void {
    if (this.drawing && this.lastState) for (const l of this.stateListeners) l(this.lastState);
  }

  /** Where the player left the overlay, if that spot is still on a monitor; else the primary's corner. */
  private async overlayStartPosition(): Promise<PhysicalPosition> {
    const saved = this.ctx?.config().overlayPos;
    if (saved) {
      const onScreen = (await availableMonitors()).some((m) => {
        const a = m.workArea ?? { position: m.position, size: m.size };
        const px = saved.x + 40; // a corner of the overlay must be inside, not just one pixel
        const py = saved.y + 40;
        return px >= a.position.x && py >= a.position.y && px < a.position.x + a.size.width && py < a.position.y + a.size.height;
      });
      if (onScreen) return new PhysicalPosition(saved.x, saved.y);
    }
    const primary = await primaryMonitor();
    if (!primary) return new PhysicalPosition(kOverlayMargin, kOverlayMargin);
    const wa = primary.workArea ?? { position: primary.position, size: primary.size };
    const m = Math.round(kOverlayMargin * primary.scaleFactor);
    return new PhysicalPosition(wa.position.x + m, wa.position.y + m);
  }

  /** Creates the overlay window (closed while unused: its webview costs ~60 MB). */
  private ensureOverlay(): Promise<void> {
    this.overlayReady ??= (async () => {
      await invoke("window_open", { label: "overlay" });
      const w = await Window.getByLabel("overlay");
      if (!w) throw new Error("overlay window missing");
      await invoke("set_click_through", { label: "overlay", on: !this.overlayInteractive });
      await w.setPosition(await this.overlayStartPosition());
      // remember where the player drags it (saved once it stops moving)
      await w.onMoved(({ payload }) => {
        if (this.overlayMoveTimer) clearTimeout(this.overlayMoveTimer);
        this.overlayMoveTimer = setTimeout(() => this.ctx?.setConfig({ overlayPos: { x: payload.x, y: payload.y } }), 800);
      });
      this.overlay = w;
    })().catch((e: unknown) => {
      this.overlayReady = null;
      console.error("could not open the overlay", e);
    });
    return this.overlayReady;
  }

  showDashboard(stealFocus: boolean): void {
    const w = this.dashboard;
    this.dashboardShown = true;
    this.catchUp();
    void (async () => {
      // shown/hidden only through window_show/window_hide (see src-tauri/src/main.rs: set_shown)
      if (stealFocus) await invoke("window_show", { label: "dashboard", activate: true });
      else if (!(await w.isVisible())) await invoke("window_show", { label: "dashboard", activate: false }); // the game keeps the keyboard
    })();
  }

  setOverlayVisible(visible: boolean): void {
    this.overlayVisible = visible;
    if (visible) {
      void this.ensureOverlay().then(() => {
        if (this.overlayVisible && this.overlay) void invoke("window_show", { label: "overlay", activate: false });
      });
      return;
    }
    if (this.overlay) void invoke("window_hide", { label: "overlay" });
  }

  /**
   * The overlay window lives while the game runs (F9 and alt-tab are instant: creating the webview
   * takes 1-2 s) and is released when the game closes (~60 MB).
   */
  gameRunningChanged(running: boolean): void {
    if (this.overlayCloseTimer) clearTimeout(this.overlayCloseTimer);
    this.overlayCloseTimer = null;
    if (running) {
      void this.ensureOverlay();
      return;
    }
    // a little grace: a game restart (crash, patch) comes right back
    this.overlayCloseTimer = setTimeout(() => {
      if (this.overlayVisible || !this.overlay) return;
      this.overlay = null;
      this.overlayReady = null;
      void invoke("window_close", { label: "overlay" });
    }, kOverlayKeepMs);
  }

  setOverlayInteractive(on: boolean): void {
    this.overlayInteractive = on;
    if (this.overlay) void invoke("set_click_through", { label: "overlay", on: !on });
  }

  async listDisplays(): Promise<DisplayInfo[]> {
    const [monitors, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
    return monitors.map((m, i) => ({
      id: monitorId(m),
      label: `Monitor ${i + 1}${m.name ? ` (${m.name.replace(/^\\\\\.\\/, "")})` : ""}`,
      width: Math.round(m.size.width / m.scaleFactor),
      height: Math.round(m.size.height / m.scaleFactor),
      primary: m.name === primary?.name,
    }));
  }

  async moveDashboard(displayId: number, fullscreen: boolean): Promise<void> {
    const m = (await availableMonitors()).find((x) => monitorId(x) === displayId);
    if (m) await this.place(m, fullscreen);
  }

  private async place(m: Monitor, fullscreen: boolean): Promise<void> {
    const w = this.dashboard;
    if (await w.isFullscreen()) await w.setFullscreen(false);
    const wa = m.workArea ?? { position: m.position, size: m.size };
    const width = Math.min(Math.round(kDashboardSize.width * m.scaleFactor), wa.size.width);
    const height = Math.min(Math.round(kDashboardSize.height * m.scaleFactor), wa.size.height);
    await w.setSize(new PhysicalSize(width, height));
    await w.setPosition(
      new PhysicalPosition(wa.position.x + Math.round((wa.size.width - width) / 2), wa.position.y + Math.round((wa.size.height - height) / 2)),
    );
    if (fullscreen) await w.setFullscreen(true);
  }

  updateTray(t: TrayState): void {
    const tray = this.tray;
    const ctx = this.ctx;
    const key = JSON.stringify(t);
    if (!tray || !ctx || key === this.trayKey) return;
    this.trayKey = key;
    void (async () => {
      await tray.setTooltip(t.tooltip);
      const menu = await Menu.new({
        items: [
          { id: "open", text: "Abrir painel", action: () => this.showDashboard(true) },
          { item: "Separator" },
          { id: "overlay", text: "Overlay no jogo (F9)", checked: t.overlayEnabled, action: () => ctx.toggleOverlay() },
          {
            id: "price",
            text: "Price check (Ctrl+C no item)",
            checked: t.priceCheckEnabled,
            action: () => ctx.setConfig({ priceCheckEnabled: !ctx.config().priceCheckEnabled }),
          },
          {
            id: "gamestart",
            text: "Abrir o painel quando o jogo abrir",
            checked: t.showDashboardOnGameStart,
            action: () => ctx.setConfig({ showDashboardOnGameStart: !ctx.config().showDashboardOnGameStart }),
          },
          { id: "autostart", text: "Iniciar com o Windows", checked: t.startWithWindows, action: () => ctx.setStartWithWindows(!t.startWithWindows) },
          { item: "Separator" },
          { id: "quit", text: "Sair", action: () => this.quit() },
        ],
      });
      await tray.setMenu(menu);
    })();
  }

  notify(title: string, body: string): void {
    sendNotification({ title, body });
  }

  startWithWindows(): Promise<boolean> {
    return isEnabled();
  }

  async setStartWithWindows(on: boolean): Promise<void> {
    if (on) await enable();
    else await disable();
  }

  /** Set by boot.ts once the updater exists. */
  updater: TauriUpdater | null = null;

  /** "Reiniciar e atualizar": save, then run the downloaded installer. */
  installUpdate(): void {
    if (this.updater?.ready) this.quit();
  }

  /** "Sair": save progress; a downloaded update is installed on the way out. */
  quit(): void {
    void (async () => {
      try {
        await this.ctx?.beforeQuit();
        if (this.updater?.ready) await this.updater.install();
      } catch (e) {
        console.error("quit", e);
      } finally {
        await invoke("app_quit");
      }
    })();
  }
}
