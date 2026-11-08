// Builds strings for the game's stash / vendor search box (regex, max 50 characters). The user
// pastes them with Ctrl+F, Ctrl+V: nothing is typed into the game for them.
//
// Map mod texts below are the game's own wording (as listed in Path of Building's ModMap.lua,
// "Item data (c) Grinding Gear Games"), with numbers removed. Labels are pt-BR.

export const kSearchMax = 50;

export interface MapModDef {
  id: string;
  label: string;
  /** game text, lower case, numbers removed */
  text: string;
  /** shown first: the usual "build bricking" mods */
  common?: boolean;
  /** the trade site's wording when it differs (it writes "more"/"increased" with a negative value) */
  tradeText?: string;
}

export const MAP_MODS: MapModDef[] = [
  { id: "phys-reflect", label: "Reflete dano físico", text: "monsters reflect % of physical damage", common: true },
  { id: "ele-reflect", label: "Reflete dano elemental", text: "monsters reflect % of elemental damage", common: true },
  { id: "no-regen", label: "Sem regeneração", text: "players cannot regenerate life, mana or energy shield", common: true },
  { id: "no-leech", label: "Monstros não podem ser drenados (leech)", text: "monsters cannot be leeched from", common: true },
  { id: "max-res", label: "Menos resistência máxima", text: "players have minus ( to )% to all maximum resistances", common: true },
  { id: "less-recovery", label: "Menos recuperação de vida/ES", text: "players have % less recovery rate of life and energy shield", common: true },
  { id: "hexproof", label: "Monstros imunes a hex (Hexproof)", text: "monsters are hexproof", common: true },
  { id: "ele-ailments", label: "Monstros evitam ailments elementais", text: "monsters have % chance to avoid elemental ailments", common: true },
  { id: "avoid-poison-bleed", label: "Monstros evitam poison/impale/bleed", text: "monsters have a % chance to avoid poison, impale, and bleeding", common: true },
  { id: "less-aoe", label: "Menos área de efeito", text: "players have % less area of effect", common: true },
  { id: "no-exposure", label: "Não pode aplicar Exposure", text: "players cannot inflict exposure" },
  { id: "less-cdr", label: "Menos recuperação de cooldown", text: "players have % less cooldown recovery rate", tradeText: "Players have #% more Cooldown Recovery Rate" },
  { id: "buffs-expire", label: "Buffs acabam mais rápido", text: "buffs on players expire % faster" },
  { id: "aura-effect", label: "Menos efeito de auras", text: "players have % reduced effect of non-curse auras from skills", tradeText: "Players have #% increased effect of Non-Curse Auras from Skills" },
  { id: "less-accuracy", label: "Menos precisão (accuracy)", text: "players have % less accuracy rating", tradeText: "Players have #% more Accuracy Rating" },
  { id: "less-armour-block", label: "Menos armadura e bloqueio", text: "players have % less armour" },
  { id: "flask-charges", label: "Menos cargas de frasco", text: "players gain % reduced flask charges" },
  { id: "curse-effect", label: "Menos efeito de curses", text: "% less effect of curses on monsters" },
  { id: "crit-reduce", label: "Monstros levam menos dano crítico", text: "monsters take ( to )% reduced extra damage from critical strikes" },
  { id: "suppress", label: "Monstros suprimem dano de feitiço", text: "monsters have +% chance to suppress spell damage" },
  { id: "always-ignite", label: "Acertos sempre causam Ignite", text: "all monster damage from hits always ignites" },
  { id: "blind", label: "Monstros cegam (Blind)", text: "monsters blind on hit", tradeText: "Monsters have #% chance to Blind on Hit" },
  { id: "poison", label: "Monstros envenenam", text: "monsters poison on hit" },
  { id: "withered", label: "Monstros aplicam Withered", text: "monsters inflict withered for seconds on hit", tradeText: "Monsters have #% chance to inflict Withered for 2 seconds on Hit" },
  { id: "extra-chaos", label: "Dano físico extra como caos", text: "monsters gain ( to )% of their physical damage as extra chaos damage" },
  { id: "monster-crit", label: "Monstros com mais crítico", text: "monsters have ( to )% increased critical strike chance" },
  { id: "es-on-life", label: "Monstros ganham ES extra", text: "monsters gain ( to )% of maximum life as extra maximum energy shield" },
  { id: "impale", label: "Monstros causam Impale", text: "monsters' attacks have % chance to impale on hit" },
  { id: "ele-res", label: "Monstros com mais resistência elemental", text: "+% monster elemental resistances" },
  { id: "phys-reduction", label: "Monstros com redução física", text: "+% monster physical damage reduction" },
];

/** Other text that sits on a map item and must never match an exclusion. */
const MAP_ITEM_TEXT = [
  // common map mods nobody excludes
  "area has patches of burning ground",
  "area has patches of chilled ground",
  "area has patches of shocked ground",
  "area has patches of desecrated ground",
  "area has patches of consecrated ground",
  "area contains many totems",
  "area contains two unique bosses",
  "area has increased monster variety",
  "monsters fire additional projectiles",
  "monsters have % increased area of effect",
  "monsters' skills chain additional times",
  "players are cursed with elemental weakness",
  "players are cursed with vulnerability",
  "players are cursed with enfeeble",
  "players are cursed with temporal chains",
  "monsters gain an endurance charge on hit",
  "monsters gain a frenzy charge on hit",
  "monsters gain a power charge on hit",
  "rare monsters each have a nemesis mod",
  "magic monster packs each have a bloodline mod",
  "monsters cannot be stunned",
  "( to )% more monster life",
  "( to )% increased monster damage",
  "( to )% increased monster movement speed",
  "( to )% increased monster attack speed",
  "( to )% increased monster cast speed",
  "unique boss deals % increased damage",
  "unique boss has % increased life",
  "item quantity",
  "item rarity",
  "monster pack size",
  "more scarabs",
  "more currency",
  "more maps",
  "map tier",
  "item level",
  "area is influenced by",
  "travel to this map by using it in a personal map device",
  "corrupted",
];

function corpus(exceptId: string): string[] {
  return [...MAP_MODS.filter((m) => m.id !== exceptId).map((m) => m.text), ...MAP_ITEM_TEXT];
}

/** Fragments shorter than this could hit map names or mods we do not know about. */
const kMinFragment = 4;

/**
 * Shortest piece of the mod's text (at least 4 characters, starting at a word, letters/spaces/
 * apostrophes only) that appears in no other map mod or map item line, so excluding it cannot
 * drop good maps.
 */
export function uniqueFragment(mod: MapModDef): string | null {
  const t = mod.text;
  const others = corpus(mod.id);
  for (let len = kMinFragment; len <= t.length; len++) {
    const seen = new Set<string>();
    for (let i = 0; i + len <= t.length; i++) {
      if (i > 0 && t[i - 1] !== " ") continue; // start at a word
      const s = t.slice(i, i + len);
      if (seen.has(s) || !/^[a-z' ]+$/.test(s) || s.startsWith(" ") || s.endsWith(" ")) continue;
      seen.add(s);
      if (!others.some((o) => o.includes(s))) return s;
    }
  }
  return null;
}

export interface SearchString {
  text: string;
  length: number;
  ok: boolean;
  /** what each part means, for the UI */
  parts: string[];
}

function finish(terms: string[], parts: string[]): SearchString {
  const text = terms.join(" ");
  return { text, length: text.length, ok: text.length > 0 && text.length <= kSearchMax, parts };
}

/** Regex for numbers >= min (0-999), e.g. 70 -> "([7-9]\d|\d{3})". */
export function atLeast(min: number): string {
  if (min <= 0) return "\\d+";
  if (min >= 100) return min === 100 ? "\\d{3}" : `(${atLeastHundreds(min)})`;
  const tens = Math.floor(min / 10);
  const ones = min % 10;
  const alts: string[] = [];
  if (ones === 0) alts.push(tens === 9 ? "9\\d" : `[${tens}-9]\\d`);
  else {
    alts.push(ones === 9 ? `${tens}9` : `${tens}[${ones}-9]`);
    if (tens < 9) alts.push(tens + 1 === 9 ? "9\\d" : `[${tens + 1}-9]\\d`);
  }
  alts.push("\\d{3}");
  return `(${alts.join("|")})`;
}

function atLeastHundreds(min: number): string {
  // rare on maps (8-mod T17); keep it simple: 1xx-9xx at or above the hundreds digit
  const h = Math.floor(min / 100);
  return h >= 9 ? "9\\d\\d" : `[${h}-9]\\d\\d`;
}

/** `"!refl|t reg" "tity: \+([7-9]\d|\d{3})%"`: maps without the chosen mods and with enough quantity. */
export function mapSearch(excludeIds: string[], minQuantity: number | null): SearchString {
  const terms: string[] = [];
  const parts: string[] = [];
  const frags: string[] = [];
  for (const id of excludeIds) {
    const mod = MAP_MODS.find((m) => m.id === id);
    const f = mod && uniqueFragment(mod);
    if (mod && f) {
      frags.push(f);
      parts.push(`sem "${mod.label}" (${f})`);
    }
  }
  if (frags.length) terms.push(`"!${frags.join("|")}"`);
  if (minQuantity && minQuantity > 0) {
    terms.push(`"y: \\+${atLeast(minQuantity)}%"`);
    parts.push(`quantidade de itens >= ${minQuantity}%`);
  }
  return finish(terms, parts);
}

const COLOR_OF: Record<string, string> = { strength: "r", dexterity: "g", intelligence: "b" };

/** Socket colors of a gem list from their main attribute ("r", "g", "b"); unknown gems are skipped. */
export function gemColors(names: string[], attrOf: (name: string) => string | undefined): string[] {
  return names.map((n) => COLOR_OF[attrOf(n) ?? ""]).filter((c): c is string => !!c);
}

function permutations(xs: string[]): string[][] {
  if (xs.length <= 1) return [xs];
  const out: string[][] = [];
  xs.forEach((x, i) => {
    for (const p of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

/**
 * Vendor search for linked sockets holding these colors (white sockets count as any color),
 * e.g. ["b","b","g"] -> "[bw]-[bw]-[gw]|[bw]-[gw]-[bw]|[gw]-[bw]-[bw]". Falls back to "any N-link"
 * when the exact colors do not fit in the box.
 */
export function linkSearch(colors: string[]): SearchString {
  const n = colors.length;
  if (n < 2) return finish([], []);
  const uniq = [...new Set(permutations(colors).map((p) => p.map((c) => `[${c}w]`).join("-")))];
  const exact = `"${uniq.join("|")}"`;
  const label = colors.join("").toUpperCase();
  if (exact.length <= kSearchMax) return finish([exact], [`${n} sockets ligados nas cores ${label} (branco serve)`]);
  return finish([`"([rgbw]-){${n - 1}}[rgbw]"`], [`qualquer item com ${n} links (as cores ${label} não cabem nos 50 caracteres)`]);
}

/** Movement speed boots at a vendor: "10% increased Movement Speed". */
export function movementSearch(): SearchString {
  return finish([`"\\d+% increased movem"`], ["botas com velocidade de movimento"]);
}
