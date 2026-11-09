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
/** How long a hidden overlay window is kept before it is closed (memory). */
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
    if (!hidden) await this.dashboard.show();

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
  }

  private get drawing(): boolean {
    return this.dashboardShown && !document.hidden;
  }

  private catchUp(): void {
    if (this.drawing && this.lastState) for (const l of this.stateListeners) l(this.lastState);
  }

  /** Creates the overlay window (closed while unused: its webview costs ~60 MB). */
  private ensureOverlay(): Promise<void> {
    this.overlayReady ??= (async () => {
      await invoke("overlay_open");
      const w = await Window.getByLabel("overlay");
      if (!w) throw new Error("overlay window missing");
      await w.setIgnoreCursorEvents(!this.overlayInteractive);
      const primary = await primaryMonitor();
      if (primary) {
        const wa = primary.workArea ?? { position: primary.position, size: primary.size };
        const m = Math.round(kOverlayMargin * primary.scaleFactor);
        await w.setPosition(new PhysicalPosition(wa.position.x + m, wa.position.y + m));
      }
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
      if (await w.isMinimized()) await w.unminimize();
      if (stealFocus) {
        await w.show();
        await w.setFocus();
      } else if (!(await w.isVisible())) {
        await invoke("show_inactive", { label: "dashboard" }); // the game keeps the keyboard
      }
    })();
  }

  setOverlayVisible(visible: boolean): void {
    this.overlayVisible = visible;
    if (this.overlayCloseTimer) clearTimeout(this.overlayCloseTimer);
    this.overlayCloseTimer = null;
    if (visible) {
      void this.ensureOverlay().then(() => {
        if (this.overlayVisible && this.overlay) void invoke("show_inactive", { label: "overlay" });
      });
      return;
    }
    void this.overlay?.hide();
    // alt-tab comes back soon; a closed game or F9 off for a while frees the window
    this.overlayCloseTimer = setTimeout(() => {
      if (this.overlayVisible || !this.overlay) return;
      this.overlay = null;
      this.overlayReady = null;
      void invoke("overlay_close");
    }, kOverlayKeepMs);
  }

  setOverlayInteractive(on: boolean): void {
    this.overlayInteractive = on;
    void this.overlay?.setIgnoreCursorEvents(!on);
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
