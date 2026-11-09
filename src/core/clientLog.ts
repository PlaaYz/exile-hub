import { parseTradeWhisper, type TradeOffer } from "./tradeWhisper";
// Parser for Path of Exile's logs/Client.txt.
// Every pattern is anchored to the "[INFO|DEBUG Client <pid>]" prefix so that chat
// messages (which look like "[INFO Client 1] #Player: ...") can never spoof an event.
// NOTE: formats are the ones documented by community tools; verify against your own Client.txt.

export type LogEvent =
  | { type: "area"; areaId: string; areaLevel: number; seed: number; ts: number | null }
  | { type: "enter"; name: string; ts: number | null }
  | { type: "levelup"; character: string; className: string; level: number; ts: number | null; pid: number }
  | { type: "passive"; allocated: boolean; skillId: string; name: string; ts: number | null; pid: number }
  | { type: "death"; character: string; ts: number | null }
  | { type: "focus"; focused: boolean; ts: number | null; closing?: true; /** a new game process started */ opening?: true }
  | { type: "npc"; speaker: string; mechanic: string; ts: number | null }
  /**
   * a whisper received ("@From [<GUILD>] Name: ..."): only the sender, plus the buy request when the
   * message is the trade site's template; any other message text is not kept
   */
  | { type: "whisper"; from: string; ts: number | null; offer?: TradeOffer }
  /** another player came into your area (": Name has joined the area.") */
  | { type: "join"; name: string; ts: number | null }
  /**
   * the client connected to the login server: game start or back to character select. The next
   * area is where the (possibly other) character logged in; the log never names it.
   */
  | { type: "login"; ts: number | null };

/**
 * League-mechanic NPCs whose dialogue shows up in Client.txt when they appear in a zone
 * (checked against the owner's log, 2026). Speaker name -> mechanic shown to the user.
 */
export const MECHANIC_NPCS: Record<string, string> = {
  "Niko, Master of the Depths": "Delve (Niko)",
  "Einhar, Beastmaster": "Bestiário (Einhar)",
  "Alva Valai": "Incursion (Alva)",
  "Jun, Veiled Master": "Betrayal (Jun)",
  "Sister Cassia": "Blight (Cassia)",
  "The Trialmaster": "Ultimatum",
  "Tane Octavius": "Metamorph (Tane)",
  "Ailith, First of the Keepers": "Breach (Ailith)",
  "Valerie, the Corsair": "Deepwater (Valerie)",
  "The Envoy": "Maven (Envoy)",
  "The Maven": "Maven (testemunha)",
  "Zana, Master Cartographer": "Zana",
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NPC_RE = new RegExp(`\\[INFO Client \\d+\\] (${Object.keys(MECHANIC_NPCS).map(escapeRe).join("|")}): `);

const LOGIN_RE = /\[INFO Client \d+\] Async connecting to \S*login\.pathofexile\.com/;
// character names have no spaces or colons; a guild tag may come first
const WHISPER_RE = /\[INFO Client \d+\] @From (?:<[^>]*> )?([^\s:<>]+): (.*)$/;
const JOIN_RE = /\[INFO Client \d+\] : ([^\s:<>]+) has joined the area\.\s*$/;
const TS_RE =/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/;
const GENERATING_RE =
  /\[(?:DEBUG|INFO) Client \d+\] Generating level (\d+) area "([^"]+)" with seed (\d+)/;
const ENTERED_RE = /\[INFO Client \d+\] : You have entered (.+?)\.\s*$/;
const LEVELUP_RE = /\[INFO Client (\d+)\] : (.+?) \(([^)]+)\) is now level (\d+)\s*$/;
// the pid in "Client <pid>" changes every time the game starts: used to tell game sessions apart
const PASSIVE_RE = /\[INFO Client (\d+)\] Successfully (allocated|unallocated) passive skill id: ([^,]+), name: (.+?)\s*$/;
const DEATH_RE = /\[INFO Client \d+\] : (.+?) has been slain\.\s*$/;
const FOCUS_RE = /\[INFO Client \d+\] \[WINDOW\] (Gained|Lost) focus\s*$/;
// a closed game counts as "not focused" (the overlay hides); "Gained focus" follows a restart
const CLOSING_RE = /\[INFO Client \d+\] Closing game gracefully\s*$/;
// a new game start: if the previous one crashed there was no closing line, this ends it too
const OPENING_RE = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \*{5} LOG FILE OPENING \*{5}\s*$/;

export function parseTimestamp(line: string): number | null {
  const m = TS_RE.exec(line);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
}

export function parseLine(rawLine: string): LogEvent | null {
  const line = rawLine.replace(/\r$/, "");
  if (line.length === 0) return null;
  const ts = parseTimestamp(line);

  let m = GENERATING_RE.exec(line);
  if (m) return { type: "area", areaLevel: +m[1], areaId: m[2], seed: +m[3], ts };

  m = ENTERED_RE.exec(line);
  if (m) return { type: "enter", name: m[1], ts };

  m = LEVELUP_RE.exec(line);
  if (m) return { type: "levelup", pid: +m[1], character: m[2], className: m[3], level: +m[4], ts };

  m = PASSIVE_RE.exec(line);
  if (m) return { type: "passive", pid: +m[1], allocated: m[2] === "allocated", skillId: m[3], name: m[4], ts };

  m = DEATH_RE.exec(line);
  if (m) return { type: "death", character: m[1], ts };

  m = FOCUS_RE.exec(line);
  if (m) return { type: "focus", focused: m[1] === "Gained", ts };

  if (CLOSING_RE.test(line)) return { type: "focus", focused: false, ts, closing: true };
  // a new start also ends the previous game (crashes leave no closing line)
  if (OPENING_RE.test(line)) return { type: "focus", focused: false, ts, closing: true, opening: true };

  m = NPC_RE.exec(line);
  if (m) return { type: "npc", speaker: m[1], mechanic: MECHANIC_NPCS[m[1]], ts };

  m = WHISPER_RE.exec(line);
  if (m) {
    const offer = parseTradeWhisper(m[2]);
    return offer ? { type: "whisper", from: m[1], ts, offer } : { type: "whisper", from: m[1], ts };
  }

  m = JOIN_RE.exec(line);
  if (m) return { type: "join", name: m[1], ts };

  if (LOGIN_RE.test(line)) return { type: "login", ts };

  return null;
}

/** Common install locations; the user can always pick the file manually. */
export function candidateLogPaths(): string[] {
  const rel = "Path of Exile\\logs\\Client.txt";
  const steam = "steamapps\\common\\" + rel;
  const out = [
    `C:\\Program Files (x86)\\Steam\\${steam}`,
    `C:\\Program Files (x86)\\Grinding Gear Games\\${rel}`,
    `C:\\Program Files\\Grinding Gear Games\\${rel}`,
  ];
  for (const drive of ["D", "E", "F", "G"]) {
    out.push(`${drive}:\\SteamLibrary\\${steam}`);
    out.push(`${drive}:\\Steam\\${steam}`);
    out.push(`${drive}:\\Games\\Grinding Gear Games\\${rel}`);
  }
  return out;
}
