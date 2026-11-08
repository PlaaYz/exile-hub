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
  private tray: TrayIcon | null = null;
  private trayKey = "";
  private trayNotified = false;

  async init(hidden: boolean): Promise<void> {
    this.overlay = await Window.getByLabel("overlay");
    await this.overlay?.setIgnoreCursorEvents(true);
    const primary = await primaryMonitor();
    if (primary && this.overlay) {
      const wa = primary.workArea ?? { position: primary.position, size: primary.size };
      const m = Math.round(kOverlayMargin * primary.scaleFactor);
      await this.overlay.setPosition(new PhysicalPosition(wa.position.x + m, wa.position.y + m));
    }
    // default to the secondary monitor (the game stays on the primary one)
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
    for (const l of this.stateListeners) l(state);
    if (this.overlayVisible) void emitTo("overlay", "state", state);
  }

  showDashboard(stealFocus: boolean): void {
    const w = this.dashboard;
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
    if (visible) void invoke("show_inactive", { label: "overlay" });
    else void this.overlay?.hide();
  }

  setOverlayInteractive(on: boolean): void {
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
