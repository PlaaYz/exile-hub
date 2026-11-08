// Process-wide constants and helpers of the main process (paths, tunables, HTTP, icon).
import { app, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { TradeFetch } from "../core/trade";
import { drawIconBGRA } from "../shared/icon";

// ---- tunables --------------------------------------------------------------
export const kOverlayToggleKey = "F9"; // show / hide the in-game overlay
export const kOverlayInteractKey = "F10"; // overlay clickable (drag / buttons) <-> click-through
export const kOverlaySize = { width: 440, height: 560 };
export const kOverlayMargin = 24;
export const kStateBroadcastMs = 1000; // timers tick through this
export const kBackfillBytes = 256 * 1024; // how much of Client.txt tail to scan on startup
export const kPobFetchTimeoutMs = 10_000;
export const kClipboardPollMs = 300; // price check / PoB import: how often the clipboard is looked at
export const kProgressSaveMs = 3000; // route + timers are written to disk at most this often
export const kTreeUrl = "https://raw.githubusercontent.com/grindinggear/skilltree-export/master/data.json";
export const kTreeMaxAgeMs = 7 * 24 * 3600 * 1000;
export const kGemAdviceMaxLevel = 70; // campaign only
export const kAdviceDebounceMs = 1500;
export const kHttpTimeoutMs = 15_000;
export const kStatsMaxAgeMs = 24 * 3600 * 1000; // trade stat list cache on disk
export const kUserAgent = `ExileHub/${app.getVersion()} (desktop companion; Windows)`;
// ----------------------------------------------------------------------------

export const isDev = !!process.env.VITE_DEV_URL;
export const dataDir = app.isPackaged ? path.join(process.resourcesPath, "data") : path.resolve(__dirname, "../../../data");
export const pobVendorDir = app.isPackaged
  ? path.join(process.resourcesPath, "pob")
  : path.resolve(__dirname, "../../../vendor/pob");
export const rendererIndex = path.resolve(__dirname, "../../renderer/index.html");
export const preloadPath = path.join(__dirname, "preload.js");

/** A file in the app's userData folder (config, caches, progress). */
export function userFile(name: string): string {
  return path.join(app.getPath("userData"), name);
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export const httpFetch: TradeFetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(kHttpTimeoutMs) });

/** The app icon (tray, windows), drawn in code: see src/shared/icon.ts. */
export function appIcon(): Electron.NativeImage {
  const img = nativeImage.createFromBitmap(Buffer.from(drawIconBGRA(32)), { width: 32, height: 32, scaleFactor: 2 });
  img.addRepresentation({ scaleFactor: 4, width: 64, height: 64, buffer: Buffer.from(drawIconBGRA(64)) });
  return img;
}
