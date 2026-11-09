// Electron-only constants and helpers (paths, window sizes, HTTP, icon). App tunables live in
// src/app/constants.ts.
import { app, nativeImage } from "electron";
import path from "node:path";
import type { TradeFetch } from "../core/trade";
import { drawIconBGRA } from "../shared/icon";

export const kOverlaySize = { width: 440, height: 560 };
export const kOverlayMargin = 24;
export const kHttpTimeoutMs = 15_000;
export const kUserAgent = `ExileHub/${app.getVersion()} (desktop companion; Windows)`;

export const isDev = !!process.env.VITE_DEV_URL;
export const dataDir = app.isPackaged ? path.join(process.resourcesPath, "data") : path.resolve(__dirname, "../../../data");
export const rendererIndex = path.resolve(__dirname, "../../renderer/index.html");
export const preloadPath = path.join(__dirname, "preload.js");

/** A file in the app's userData folder (config, caches, progress). */
export function userFile(name: string): string {
  return path.join(app.getPath("userData"), name);
}

export const httpFetch: TradeFetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(kHttpTimeoutMs) });

/** The app icon (tray, windows), drawn in code: see src/shared/icon.ts. */
export function appIcon(): Electron.NativeImage {
  const img = nativeImage.createFromBitmap(Buffer.from(drawIconBGRA(32)), { width: 32, height: 32, scaleFactor: 2 });
  img.addRepresentation({ scaleFactor: 4, width: 64, height: 64, buffer: Buffer.from(drawIconBGRA(64)) });
  return img;
}
