// Sandboxed preload: only imports "electron" (+ erased type imports). Channel names are
// duplicated from src/shared/ipc.ts on purpose; test/ipc.test.ts keeps them in sync.
// RECONSTRUCTED from the compiled output after an accidental overwrite.
import { contextBridge, ipcRenderer } from "electron";
import type { HubApi } from "../shared/ipc";
import type { AppConfig, AppState } from "../shared/types";

const api: HubApi = {
  getState: () => ipcRenderer.invoke("state:get"),
  onState: (cb) => {
    const handler = (_e: unknown, s: AppState) => cb(s);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.removeListener("state", handler);
  },
  setConfig: (patch: Partial<AppConfig>) => ipcRenderer.invoke("config:set", patch),
  pickLog: () => ipcRenderer.invoke("log:pick"),
  detectLog: () => ipcRenderer.invoke("log:detect"),
  routeNext: () => ipcRenderer.invoke("route:next"),
  routePrev: () => ipcRenderer.invoke("route:prev"),
  routeReset: () => ipcRenderer.invoke("route:reset"),
  routeSync: () => ipcRenderer.invoke("route:sync"),
  importPob: (input: string) => ipcRenderer.invoke("pob:import", input),
  listDisplays: () => ipcRenderer.invoke("displays:list"),
  moveDashboard: (id: number, fs: boolean) => ipcRenderer.invoke("dashboard:move", id, fs),
  toggleOverlay: () => ipcRenderer.invoke("overlay:toggle"),
  toggleOverlayInteractive: () => ipcRenderer.invoke("overlay:interactive"),
  priceResearch: (patch) => ipcRenderer.invoke("price:research", patch),
  priceOpenTrade: () => ipcRenderer.invoke("price:open-trade"),
  farmPrices: () => ipcRenderer.invoke("farm:prices"),
  setStartWithWindows: (on: boolean) => ipcRenderer.invoke("app:autostart", on),
  copyDiagReport: () => ipcRenderer.invoke("diag:copy"),
  refreshGemAdvice: () => ipcRenderer.invoke("gems:refresh"),
  getTreeLayout: () => ipcRenderer.invoke("tree:layout"),
  openMapTrade: (o) => ipcRenderer.invoke("maps:trade", o),
  installUpdate: () => ipcRenderer.invoke("update:install"),
};

contextBridge.exposeInMainWorld("hub", api);
