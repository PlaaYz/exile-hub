// Chat commands on a key (like Awakened PoE Trade): F5 -> /hideout. One key press = one chat
// message = one server action (GGG's rule for macros). Pure: validation and text expansion.

export interface ChatCommand {
  /** accelerator: optional Ctrl/Shift/Alt + F1-F12, A-Z or 0-9 ("F5", "Ctrl+H") */
  key: string;
  /** a chat command ("/hideout") or a whisper ("@{last_whisper} ty") */
  text: string;
}

/** Placeholder for the player who whispered you last (from Client.txt "@From" lines). */
export const LAST_WHISPER = "{last_whisper}";

export const DEFAULT_CHAT_COMMANDS: ChatCommand[] = [{ key: "F5", text: "/hideout" }];

/** Ready-made commands the settings screen offers. */
export const CHAT_COMMAND_PRESETS: { label: string; labelEn: string; text: string }[] = [
  { label: "Hideout", labelEn: "Hideout", text: "/hideout" },
  { label: "Seleção de personagem", labelEn: "Character select", text: "/exit" },
  { label: "Kingsmarch", labelEn: "Kingsmarch", text: "/kingsmarch" },
  { label: "Menagerie", labelEn: "Menagerie", text: "/menagerie" },
  { label: "Convidar quem sussurrou", labelEn: "Invite the last whisperer", text: `/invite ${LAST_WHISPER}` },
  { label: "Trade com quem sussurrou", labelEn: "Trade with the last whisperer", text: `/tradewith ${LAST_WHISPER}` },
  { label: "Sair da party", labelEn: "Leave the party", text: "/leave" },
  { label: "Agradecer quem sussurrou", labelEn: "Thank the last whisperer", text: `@${LAST_WHISPER} ty` },
];

/** F9/F10 belong to the overlay. */
export const RESERVED_KEYS = new Set(["F9", "F10"]);
const KEY_RE = /^(?:(?:Ctrl|Shift|Alt)\+){0,3}(?:F(?:[1-9]|1[0-2])|[A-Z]|[0-9])$/;
export const kMaxCommandText = 120;
export const kMaxCommands = 12;

/** Same key written two ways ("Shift+Ctrl+H" / "Ctrl+Shift+H") compares equal after this. */
export function normaliseKey(key: string): string {
  const parts = key.split("+").map((p) => p.trim());
  const main = parts.pop() ?? "";
  const mods = ["Ctrl", "Shift", "Alt"].filter((m) => parts.some((p) => p.toLowerCase() === m.toLowerCase()));
  return [...mods, main.toUpperCase()].join("+");
}

export function isValidKey(key: string): boolean {
  const k = normaliseKey(key);
  return KEY_RE.test(k) && !RESERVED_KEYS.has(k) && (k.includes("+") || /^F\d/.test(k)); // a bare letter would block typing
}

export function isValidText(text: string): boolean {
  return text.length > 1 && text.length <= kMaxCommandText && /^[/@]/.test(text) && !/[\r\n]/.test(text);
}

/** Keeps the valid entries, one per key, at most kMaxCommands. */
export function cleanChatCommands(v: unknown): ChatCommand[] | null {
  if (!Array.isArray(v)) return null;
  const out: ChatCommand[] = [];
  const seen = new Set<string>();
  for (const c of v) {
    if (!c || typeof c.key !== "string" || typeof c.text !== "string") continue;
    const key = normaliseKey(c.key);
    const text = c.text.trim();
    if (!isValidKey(key) || !isValidText(text) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, text });
    if (out.length >= kMaxCommands) break;
  }
  return out;
}

/** The text to type, or null when it needs a whisperer and nobody whispered yet. */
export function expandCommand(text: string, lastWhisper: string | null): string | null {
  if (!text.includes(LAST_WHISPER)) return text;
  return lastWhisper ? text.split(LAST_WHISPER).join(lastWhisper) : null;
}
