// IPC handlers: every renderer request, validated (ipcClean) before it reaches the app.
import { ipcMain } from "electron";
import type { Hub } from "../app/hub";
import { cleanConfigPatch, cleanMapTradeOptions, cleanResearch } from "../app/ipcClean";
import { CH } from "../shared/ipc";

export function registerIpc(t: Hub): void {
  ipcMain.handle(CH.stateGet, () => t.state());
  ipcMain.handle(CH.configSet, (_e, patch: unknown) => t.setConfig(cleanConfigPatch(patch)));
  ipcMain.handle(CH.logPick, () => t.pickLog());
  ipcMain.handle(CH.logDetect, async () => {
    const p = await t.detectLog();
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
    return typeof id === "number" ? t.moveDashboard(id, fullscreen === true) : undefined;
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
    return typeof on === "boolean" ? t.setStartWithWindows(on) : undefined;
  });
}
