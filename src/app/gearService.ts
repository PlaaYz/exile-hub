// "Register my equipment": while on, every item the player copies in game (Ctrl+C over each equipped
// item on the character screen) is kept as what they wear in its slot. Otherwise an item copied with
// Ctrl+C (Ctrl+D is the price key) is compared with what is worn: these real items (exact rolls, DPS and
// defences) first, the PoB build for the slots that were never registered. Kept in userData/gear.json.
import { parseItem, type ParsedItem } from "../core/item";
import { compareItem, gearSlotFor, GEAR_SLOTS, type EquippedItem } from "../core/itemCompare";
import type { GearItemView, GearView } from "../shared/types";
import type { Platform } from "./platform";

const kFile = "gear.json";
/** Registering turns itself off after this long without a new item (else price checks stay off). */
const kRegisterIdleMs = 3 * 60 * 1000;

export class GearService {
  /** item text copied from the game, by slot */
  private texts: Record<string, string> = {};
  private items: EquippedItem[] = [];
  private registering = false;
  /** slots filled in this registration (first ring = Ring 1, second = Ring 2) */
  private taken = new Set<string>();
  private idle: ReturnType<typeof setTimeout> | null = null;
  /** the last item copied outside registration (compared with what is worn) */
  private copied: ParsedItem | null = null;
  /** item art by "name|baseType" (null = poe.ninja has none) */
  private icons = new Map<string, string | null>();
  private iconsBusy = false;
  private iconsFailedAt = 0;

  constructor(
    private readonly p: Platform,
    private readonly changed: () => void,
    /** the item's art on poe.ninja; null while no league is known */
    private readonly iconOf: (item: ParsedItem) => Promise<string | null> | null,
    /** mod line -> the UI language (null = keep the game's English) */
    private readonly translate: () => ((line: string) => string) | null = () => null,
  ) {}

  async load(): Promise<void> {
    try {
      const text = await this.p.readUserFile(kFile);
      if (text) this.texts = JSON.parse(text) as Record<string, string>;
    } catch {
      /* nothing registered yet */
    }
    this.rebuild();
  }

  get register(): boolean {
    return this.registering;
  }

  setRegister(on: boolean): void {
    this.registering = on;
    this.taken.clear();
    this.touch();
    this.changed();
  }

  /** An item copied while registering: kept in its slot. Returns the slot, or null when it is not equipment. */
  add(text: string): string | null {
    const item = parseItem(text);
    const slot = item && gearSlotFor(item, this.taken);
    if (!slot) return null;
    this.taken.add(slot);
    this.texts[slot] = text;
    this.save();
    this.touch();
    this.changed();
    return slot;
  }

  /** An item copied with Ctrl+C outside registration: shown against what is worn. False when it is not equipment. */
  compare(text: string): boolean {
    const item = parseItem(text);
    if (!item || !gearSlotFor(item, new Set())) return false;
    this.copied = item;
    this.changed();
    return true;
  }

  remove(slot: string): void {
    if (!(slot in this.texts)) return;
    delete this.texts[slot];
    this.save();
    this.changed();
  }

  /** What the player wears: only what was registered in game (owner, 2026-11-12: not the PoB build). */
  worn(): readonly EquippedItem[] {
    return this.items;
  }

  view(): GearView {
    const worn = this.items;
    this.findIcons([...worn.map((e) => e.item), ...(this.copied ? [this.copied] : [])]);
    const c = this.copied;
    let copied: GearView["copied"] = null;
    if (c) {
      const t = this.translate();
      const cmp = compareItem(c, worn).map((x) => (t ? { ...x, onlyCandidate: x.onlyCandidate.map(t), onlyEquipped: x.onlyEquipped.map(t) } : x));
      copied = { item: this.itemView("", c, true), compare: cmp.length ? cmp : null };
    }
    return { register: this.registering, items: worn.map((e) => this.itemView(e.slot, e.item, !!e.fromGame)), copied };
  }

  private itemView(slot: string, item: ParsedItem, fromGame: boolean): GearItemView {
    const order = (k: string) => (k === "enchant" ? 0 : k === "implicit" ? 1 : 2);
    const t = this.translate() ?? ((l: string) => l);
    return {
      slot,
      name: item.name || item.baseType,
      baseType: item.baseType,
      rarity: item.rarity,
      itemClass: item.itemClass,
      sockets: item.sockets,
      icon: this.icons.get(iconKey(item)) ?? null,
      lines: [...item.mods].sort((a, b) => order(a.kind) - order(b.kind)).map((m) => t(m.text)),
      fromGame,
    };
  }

  /** Looks up the art of items not seen yet (one at a time; after a failure, again a minute later). */
  private findIcons(items: ParsedItem[]): void {
    const todo = items.filter((i) => !this.icons.has(iconKey(i)));
    if (!todo.length || this.iconsBusy || Date.now() - this.iconsFailedAt < 60_000) return;
    this.iconsBusy = true;
    void (async () => {
      let found = false;
      try {
        for (const item of todo) {
          const p = this.iconOf(item);
          if (!p) return; // no league yet: the next view tries again
          this.icons.set(iconKey(item), await p);
          found = true;
        }
      } catch {
        this.iconsFailedAt = Date.now();
      } finally {
        this.iconsBusy = false;
        if (found) this.changed();
      }
    })();
  }

  private rebuild(): void {
    this.items = GEAR_SLOTS.flatMap((slot) => {
      const item = this.texts[slot] ? parseItem(this.texts[slot]) : null;
      return item ? [{ slot, item, fromGame: true }] : [];
    });
  }

  private save(): void {
    this.rebuild();
    void this.p.writeUserFile(kFile, JSON.stringify(this.texts)).catch((e) => console.error("could not save gear", e));
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = this.registering ? setTimeout(() => this.setRegister(false), kRegisterIdleMs) : null;
  }
}

const iconKey = (i: ParsedItem) => `${i.rarity === "Unique" ? i.name : ""}|${i.baseType}`;
