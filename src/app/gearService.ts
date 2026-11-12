// "Register my equipment": while on, every item the player copies in game (Ctrl+C over each equipped
// item on the character screen) is kept as what they wear in its slot, instead of being price
// checked. Price checks then compare against these real items (exact rolls, DPS and defences), and
// the PoB build only fills the slots that were never registered. Kept in userData/gear.json.
import { parseItem } from "../core/item";
import { gearSlotFor, GEAR_SLOTS, type EquippedItem } from "../core/itemCompare";
import type { AppState } from "../shared/types";
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

  constructor(
    private readonly p: Platform,
    private readonly changed: () => void,
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

  remove(slot: string): void {
    if (!(slot in this.texts)) return;
    delete this.texts[slot];
    this.save();
    this.changed();
  }

  /** What the player wears: registered items first, the PoB build for the other slots. */
  merged(pob: readonly EquippedItem[]): EquippedItem[] {
    return [...this.items, ...pob.filter((e) => !(e.slot in this.texts))];
  }

  view(): AppState["gear"] {
    return {
      register: this.registering,
      items: this.items.map((e) => ({ slot: e.slot, name: e.item.name || e.item.baseType, rarity: e.item.rarity })),
    };
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
