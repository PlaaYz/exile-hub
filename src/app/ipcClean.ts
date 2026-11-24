// Validation of everything the renderer sends to the main process. Pure (no Electron): tested.
import { cleanChatCommands, DEFAULT_CHAT_COMMANDS, isValidKey, normaliseKey } from "../core/chatCommands";
import type { AppConfig } from "../shared/types";

export const DEFAULT_CONFIG: AppConfig = {
  clientLogPath: null,
  leagueStart: true,
  dashboardDisplayId: null,
  dashboardFullscreen: false,
  overlayEnabled: true,
  priceCheckEnabled: true,
  priceCheckKey: "Ctrl+D",
  league: null,
  overlayHideUnfocused: true,
  showDashboardOnGameStart: true,
  chatCommandsEnabled: true,
  chatCommands: DEFAULT_CHAT_COMMANDS,
  overlayPos: null,
  showDiagTab: false,
  welcomeDone: false,
  language: "auto",
  tradeAlerts: true,
};

type Kind = "boolean" | "string-or-null" | "internal" | "chat-commands" | "hotkey" | "language";
/**
 * How each config key may be set from the renderer. Every AppConfig key must be listed (the
 * compiler enforces it), so a new setting cannot silently be ignored by the settings screen.
 * "internal" keys are only changed by the main process (e.g. through moveDashboard).
 */
const CONFIG_KEYS: Record<keyof AppConfig, Kind> = {
  clientLogPath: "string-or-null",
  leagueStart: "boolean",
  dashboardDisplayId: "internal",
  dashboardFullscreen: "boolean",
  overlayEnabled: "boolean",
  priceCheckEnabled: "boolean",
  priceCheckKey: "hotkey",
  league: "string-or-null",
  overlayHideUnfocused: "boolean",
  showDashboardOnGameStart: "boolean",
  chatCommandsEnabled: "boolean",
  chatCommands: "chat-commands",
  overlayPos: "internal",
  showDiagTab: "boolean",
  welcomeDone: "boolean",
  language: "language",
  tradeAlerts: "boolean",
};

/** Only known keys with the right primitive type. */
export function cleanConfigPatch(patch: unknown): Partial<AppConfig> {
  const p = (patch ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(CONFIG_KEYS) as [keyof AppConfig, Kind][]) {
    if (!(key in p)) continue;
    const v = p[key];
    if (kind === "boolean" && typeof v === "boolean") out[key] = v;
    if (kind === "string-or-null" && (typeof v === "string" || v === null)) out[key] = v;
    if (kind === "hotkey" && (v === null || (typeof v === "string" && isValidKey(v)))) out[key] = v === null ? null : normaliseKey(v);
    if (kind === "language" && (v === "auto" || v === "pt" || v === "en")) out[key] = v;
    if (kind === "chat-commands") {
      const cmds = cleanChatCommands(v);
      if (cmds) out[key] = cmds;
    }
  }
  return out as Partial<AppConfig>;
}

export function cleanChallengeTick(id: unknown, done: unknown, part: unknown): { id: string; done: boolean; part: number | null } | null {
  if (typeof id !== "string" || id.length === 0 || id.length > 40 || typeof done !== "boolean") return null;
  if (part !== null && part !== undefined && !(typeof part === "number" && Number.isInteger(part) && part >= 0 && part < 100)) return null;
  return { id, done, part: typeof part === "number" ? part : null };
}
