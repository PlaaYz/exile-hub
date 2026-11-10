// UI language: Portuguese (pt-BR, the original) or English. Strings stay inline at their use site as
// tr("texto", "text") pairs (no keys, no framework). Each webview has its own copy of this module:
// the dashboard (where the app itself runs) sets it from the config, the other windows from the
// state they receive. Game names (zones, items, gems, bosses) stay in English in both languages.

export type Lang = "pt" | "en";
export type LangSetting = "auto" | Lang;

/** The OS / browser language: Portuguese for "pt-*", English otherwise. */
export function systemLang(): Lang {
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return /^pt\b/i.test(nav ?? "") ? "pt" : "en";
}

// Portuguese until the app (config) or a window (state) sets it: keeps pure code and tests stable.
let current: Lang = "pt";

export function resolveLang(setting: LangSetting | undefined | null): Lang {
  return setting === "pt" || setting === "en" ? setting : systemLang();
}

export function setLang(l: Lang): void {
  current = l;
  if (typeof document !== "undefined") document.documentElement.lang = l === "pt" ? "pt-BR" : "en";
}

export function lang(): Lang {
  return current;
}

/** The text in the current language. */
export function tr(pt: string, en: string): string {
  return current === "en" ? en : pt;
}

/** Locale for dates and numbers. */
export function locale(): string {
  return current === "en" ? "en-US" : "pt-BR";
}
