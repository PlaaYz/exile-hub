import type { Fragment, Step } from "./types";

const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];

export function dirArrow(degrees: number): string {
  const idx = (((Math.round(degrees / 45) % 8) + 8) % 8) as number;
  return ARROWS[idx];
}

/** Plain-text rendering of one fragment (used by tests and as a UI fallback). */
export function fragmentText(f: Fragment): string {
  switch (f.kind) {
    case "text":
      return f.text;
    case "enter":
      return `➞ ${f.name}`;
    case "area":
      return f.name;
    case "waypoint":
      return f.name ? `Waypoint to ${f.name}` : "Waypoint";
    case "waypoint_get":
      return "take the waypoint";
    case "quest":
      return f.name;
    case "label":
      return f.text;
    case "reward_vendor":
      return f.cost ? `${f.text} (${f.cost})` : f.text;
    case "logout":
      return "Logout";
    case "trial":
      return "Ascendancy trial";
    case "crafting":
      return "crafting recipe";
    case "dir":
      return dirArrow(f.degrees);
    case "portal":
      return f.mode === "set" ? "set portal" : "use portal";
    case "ascend":
      return `Lab (${f.version})`;
    case "copy":
      return f.text;
  }
}

export function stepText(step: Step): string {
  return step.fragments.map(fragmentText).join("").replace(/\s+/g, " ").trim();
}
