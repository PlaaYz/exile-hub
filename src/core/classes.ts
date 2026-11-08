// Client.txt says "Name (Class)" with the ascendancy once the character ascended; quest rewards
// and the passive tree go by the base class.
const BASE_OF: Record<string, string> = {
  Juggernaut: "Marauder",
  Berserker: "Marauder",
  Chieftain: "Marauder",
  Deadeye: "Ranger",
  Raider: "Ranger",
  Warden: "Ranger",
  Pathfinder: "Ranger",
  Occultist: "Witch",
  Elementalist: "Witch",
  Necromancer: "Witch",
  Slayer: "Duelist",
  Gladiator: "Duelist",
  Champion: "Duelist",
  Inquisitor: "Templar",
  Hierophant: "Templar",
  Guardian: "Templar",
  Assassin: "Shadow",
  Trickster: "Shadow",
  Saboteur: "Shadow",
  Ascendant: "Scion",
  Reliquarian: "Scion",
};

export const BASE_CLASSES = ["Marauder", "Ranger", "Witch", "Duelist", "Templar", "Shadow", "Scion"];

/** Base class for a class or ascendancy name; null when unknown. */
export function baseClass(name: string | null | undefined): string | null {
  if (!name) return null;
  if (BASE_CLASSES.includes(name)) return name;
  return BASE_OF[name] ?? null;
}
