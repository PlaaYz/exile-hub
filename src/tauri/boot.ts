// Starts Exile Hub inside Tauri. The dashboard webview runs the app (src/app on TauriPlatform) and
// exposes window.hub to its own React UI; the overlay webview gets a window.hub that forwards a few
// calls to the dashboard through events and receives the state the same way.
import { GEAR_SLOTS } from "../core/itemCompare";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register } from "@tauri-apps/plugin-global-shortcut";
import { kOverlayInteractKey, kOverlayToggleKey, kStateBroadcastMs } from "../app/constants";
import { Hub } from "../app/hub";
import { cleanChallengeTick, cleanConfigPatch, cleanMapTradeOptions, cleanSearchPatch } from "../app/ipcClean";
import type { HubApi } from "../shared/ipc";
import type { AppState } from "../shared/types";
import { TauriPlatform, type AppInfo } from "./tauriPlatform";
import { errorText } from "./errors";
import { TauriShell } from "./tauriShell";
import { TauriUpdater } from "./tauriUpdater";
import { tr } from "../shared/i18n";

/** What the overlay and the price popup may ask the dashboard for (validated like the dashboard's own calls). */
const OVERLAY_CALLS = new Set<keyof HubApi>([
  "getState",
  "routeNext",
  "routePrev",
  "toggleOverlayInteractive",
  "priceResearch",
  "priceOpenTrade",
  "priceMore",
  "priceRecheck",
  "priceWhisper",
  "closePricePopup",
  "tradeAction",
  "closeSessionSummary",
  "openDonate",
]);

interface CallMsg {
  id: number;
  /** label of the window that asked: the reply goes back to it */
  from: string;
  method: keyof HubApi;
  args: unknown[];
}
interface ReplyMsg {
  id: number;
  result?: unknown;
  error?: string;
}

/** window.hub for the dashboard: straight calls into the app, input validated as on Electron's IPC. */
function localApi(hub: Hub, shell: TauriShell): HubApi {
  return {
    getState: async () => hub.state(),
    onState: (cb) => {
      shell.stateListeners.add(cb);
      return () => shell.stateListeners.delete(cb);
    },
    setConfig: async (patch) => hub.setConfig(cleanConfigPatch(patch)),
    pickLog: () => hub.pickLog(),
    detectLog: async () => {
      const p = await hub.detectLog();
      if (p) hub.setConfig({ clientLogPath: p });
      return p;
    },
    routeNext: async () => hub.routeNext(),
    routePrev: async () => hub.routePrev(),
    routeReset: async () => hub.routeReset(),
    routeSync: async () => hub.routeSync(),
    importPob: (input) => (typeof input === "string" ? hub.importBuild(input) : Promise.resolve({ ok: false, error: tr("entrada inválida", "invalid input") })),
    listDisplays: () => hub.listDisplays(),
    moveDashboard: (id, fs) => hub.moveDashboard(id, fs === true),
    toggleOverlay: async () => hub.toggleOverlay(),
    toggleOverlayInteractive: async () => hub.toggleOverlayInteractive(),
    priceResearch: async (patch) => {
      const p = cleanSearchPatch(patch);
      if (p) hub.priceResearch(p);
    },
    priceOpenTrade: async () => hub.priceOpenTrade(),
    farmPrices: () => hub.farmPrices(),
    setStartWithWindows: (on) => hub.setStartWithWindows(on === true),
    copyDiagReport: () => hub.copyDiagReport(),
    getTreeLayout: () => hub.getTreeLayout(),
    closePricePopup: async () => hub.closePricePopup(),
    closeSessionSummary: async () => hub.closeSessionSummary(),
    tradeAction: async (id, action) => {
      const ok = ["invite", "trade", "thanks", "sold", "kick", "dismiss"];
      if (typeof id === "string" && id.length < 20 && ok.includes(action)) await hub.tradeAction(id, action);
    },
    priceMore: () => hub.priceMore(),
    priceRecheck: async (id) => {
      if (Number.isInteger(id) && id > 0) hub.priceRecheck(id);
    },
    priceWhisper: async (text) => (typeof text === "string" && text.length <= 500 ? hub.priceWhisper(text) : null),
    setBuildStage: async (stage) => {
      if (Number.isInteger(stage) && stage >= 0 && stage < 100) hub.setBuildStage(stage);
    },
    copyText: async (text) => {
      if (typeof text === "string" && text.length > 0 && text.length <= 200) await hub.copyText(text);
    },
    reportProblem: () => hub.reportProblem(),
    openDonate: () => hub.openDonate(),
    setGearRegister: async (on) => hub.setGearRegister(on === true),
    removeGear: async (slot) => {
      if (typeof slot === "string" && GEAR_SLOTS.includes(slot)) hub.removeGear(slot);
    },
    setCharacter: async (name) => {
      if (typeof name === "string" && name.length <= 40) hub.setCharacter(name);
    },
    getChallenges: () => hub.getChallenges(),
    refreshChallenges: () => hub.refreshChallenges(),
    setChallenge: (id, done, part) => {
      const c = cleanChallengeTick(id, done, part);
      return c ? hub.setChallenge(c.id, c.done, c.part) : hub.getChallenges();
    },
    installUpdate: async () => hub.installUpdate(),
    openMapTrade: (o) => hub.openMapTrade(cleanMapTradeOptions(o)),
  };
}

async function overlayApi(): Promise<HubApi> {
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  await listen<ReplyMsg>("hub-reply", (e) => {
    const p = pending.get(e.payload.id);
    if (!p) return;
    pending.delete(e.payload.id);
    if (e.payload.error !== undefined) p.reject(new Error(e.payload.error));
    else p.resolve(e.payload.result);
  });
  const call =
    (method: keyof HubApi) =>
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        const id = next++;
        pending.set(id, { resolve, reject });
        void emitTo("dashboard", "hub-call", { id, from: getCurrentWindow().label, method, args } satisfies CallMsg);
      });
  return new Proxy({} as HubApi, {
    // not a thenable: "await overlayApi()" must not mistake the proxy for a promise
    get: (_t, prop) =>
      typeof prop !== "string" || prop === "then"
        ? undefined
        : prop === "onState"
        ? (cb: (s: AppState) => void) => {
            const un = listen<AppState>("state", (e) => cb(e.payload));
            return () => void un.then((f) => f());
          }
        : call(prop as keyof HubApi),
  });
}

/** windows that talk to the hub through events (each is also its own window label) */
const SECONDARY_WINDOWS = ["overlay", "price", "trades", "summary"];

export async function installTauriHub(mode: string | null): Promise<void> {
  if (mode !== null && SECONDARY_WINDOWS.includes(mode)) {
    window.hub = await overlayApi();
    return;
  }
  const info = await invoke<AppInfo>("app_info");
  const shell = new TauriShell();
  const hub = await Hub.create(new TauriPlatform(info, shell));
  shell.ctx = {
    config: () => hub.config,
    setConfig: (p) => hub.setConfig(p),
    toggleOverlay: () => hub.toggleOverlay(),
    setStartWithWindows: (on) => void hub.setStartWithWindows(on),
    beforeQuit: () => hub.shutdown(),
  };
  const api = localApi(hub, shell);
  window.hub = api;

  await listen<CallMsg>("hub-call", async (e) => {
    const { id, from, method, args } = e.payload;
    const reply: ReplyMsg = { id };
    try {
      if (!OVERLAY_CALLS.has(method) || !Array.isArray(args)) throw new Error(`not allowed: ${String(method)}`);
      reply.result = await (api[method] as (...a: unknown[]) => Promise<unknown>)(...args);
    } catch (err) {
      reply.error = errorText(err);
    }
    if (SECONDARY_WINDOWS.includes(from)) void emitTo(from, "hub-reply", reply);
  });

  await shell.init(info.hidden);
  for (const [key, action] of [
    [kOverlayToggleKey, () => hub.toggleOverlay()],
    [kOverlayInteractKey, () => hub.toggleOverlayInteractive()],
  ] as const) {
    await register(key, (e) => {
      if (e.state === "Pressed") action();
    }).catch((err: unknown) => console.error(`could not register ${key}`, err));
  }
  await hub.start();
  const updater = new TauriUpdater(
    info.version,
    (s) => {
      hub.updateState = s;
      hub.broadcast();
      if (s.status === "ready") shell.autoInstall();
    },
    (t, b) => shell.notify(t, b),
  );
  shell.updater = updater;
  hub.updateState = updater.state;
  updater.start(info.packaged);
  setInterval(() => hub.broadcast(), kStateBroadcastMs);
}
