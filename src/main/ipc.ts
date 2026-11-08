// IPC handlers: every renderer request, validated (ipcClean) before it reaches the app.
import { dialog, ipcMain, type BrowserWindow, type OpenDialogOptions } from "electron";
import type { MapTradeOptions } from "../core/mapTrade";
import { CH, type FarmPricesResult, type ImportResult } from "../shared/ipc";
import type { AppConfig, AppState, DisplayInfo } from "../shared/types";
import { cleanConfigPatch, cleanMapTradeOptions, cleanResearch } from "./ipcClean";

/** What the IPC layer needs from the app. */
export interface IpcTarget {
  state(): AppState;
  setConfig(patch: Partial<AppConfig>): void;
  detectLog(): string | null;
  dashboardWindow(): BrowserWindow | null;
  routeNext(): void;
  routePrev(): void;
  routeReset(): void;
  routeSync(): boolean;
  importBuild(input: string): Promise<ImportResult>;
  listDisplays(): DisplayInfo[];
  moveDashboard(id: number, fullscreen: boolean): void;
  toggleOverlay(): void;
  toggleOverlayInteractive(): void;
  priceResearch(patch: { statId: string; enabled: boolean; min: number | null }[]): void;
  priceOpenTrade(): void;
  openMapTrade(o: MapTradeOptions): Promise<{ ok: boolean; total?: number; missing: string[]; error?: string }>;
  farmPrices(): Promise<FarmPricesResult>;
  copyDiagReport(): void;
  refreshGemAdvice(): void;
  setStartWithWindows(on: boolean): void;
  installUpdate(): void;
}

async function pickLogFile(t: IpcTarget): Promise<void> {
  const opts: OpenDialogOptions = {
    title: "Selecione o logs/Client.txt do Path of Exile",
    properties: ["openFile"],
    filters: [{ name: "Client.txt", extensions: ["txt"] }],
  };
  const parent = t.dashboardWindow();
  const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  if (!res.canceled && res.filePaths[0]) t.setConfig({ clientLogPath: res.filePaths[0] });
}

export function registerIpc(t: IpcTarget): void {
  ipcMain.handle(CH.stateGet, () => t.state());
  ipcMain.handle(CH.configSet, (_e, patch: unknown) => t.setConfig(cleanConfigPatch(patch)));
  ipcMain.handle(CH.logPick, () => pickLogFile(t));
  ipcMain.handle(CH.logDetect, () => {
    const p = t.detectLog();
    if (p) t.setConfig({ clientLogPath: p });
    return p;
  });
  ipcMain.handle(CH.routeNext, () => t.routeNext());
  ipcMain.handle(CH.routePrev, () => t.routePrev());
  ipcMain.handle(CH.routeReset, () => t.routeReset());
  ipcMain.handle(CH.routeSync, () => t.routeSync());
  ipcMain.handle(CH.pobImport, (_e, input: unknown) =>
    typeof input === "string" ? t.importBuild(input) : { ok: false, error: "entrada inválida" },
  );
  ipcMain.handle(CH.displaysList, () => t.listDisplays());
  ipcMain.handle(CH.dashboardMove, (_e, id: unknown, fullscreen: unknown) => {
    if (typeof id === "number") t.moveDashboard(id, fullscreen === true);
  });
  ipcMain.handle(CH.overlayToggle, () => t.toggleOverlay());
  ipcMain.handle(CH.overlayInteractive, () => t.toggleOverlayInteractive());
  ipcMain.handle(CH.priceResearch, (_e, patch: unknown) => t.priceResearch(cleanResearch(patch)));
  ipcMain.handle(CH.priceOpenTrade, () => t.priceOpenTrade());
  ipcMain.handle(CH.mapTradeOpen, (_e, o: unknown) => t.openMapTrade(cleanMapTradeOptions(o)));
  ipcMain.handle(CH.farmPrices, () => t.farmPrices());
  ipcMain.handle(CH.diagCopy, () => t.copyDiagReport());
  ipcMain.handle(CH.gemAdviceRefresh, () => t.refreshGemAdvice());
  ipcMain.handle(CH.updateInstall, () => t.installUpdate());
  ipcMain.handle(CH.appAutostart, (_e, on: unknown) => {
    if (typeof on === "boolean") t.setStartWithWindows(on);
  });
}
