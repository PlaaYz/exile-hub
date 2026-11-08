// Tunables shared by every platform.
export const kOverlayToggleKey = "F9"; // show / hide the in-game overlay
export const kOverlayInteractKey = "F10"; // overlay clickable (drag / buttons) <-> click-through
export const kStateBroadcastMs = 1000; // timers tick through this
export const kBackfillBytes = 256 * 1024; // how much of Client.txt tail to scan on startup
export const kPobFetchTimeoutMs = 10_000;
export const kClipboardPollMs = 300; // price check / PoB import: how often the clipboard is looked at
export const kProgressSaveMs = 3000; // route + timers are written to disk at most this often
export const kTreeUrl = "https://raw.githubusercontent.com/grindinggear/skilltree-export/master/data.json";
export const kTreeMaxAgeMs = 7 * 24 * 3600 * 1000;
export const kGemAdviceMaxLevel = 70; // campaign only
export const kAdviceDebounceMs = 1500;
export const kStatsMaxAgeMs = 24 * 3600 * 1000; // trade stat list cache on disk
export const kTradeSite = "https://www.pathofexile.com/trade/";

export function readJsonText<T>(text: string): T {
  return JSON.parse(text) as T;
}
