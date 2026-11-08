// The settings file (config.json in the user's app data folder).
import type { AppConfig } from "../shared/types";
import { DEFAULT_CONFIG } from "./ipcClean";
import type { Platform } from "./platform";

export class ConfigStore {
  value: AppConfig = { ...DEFAULT_CONFIG };

  constructor(private readonly platform: Platform) {}

  async load(): Promise<void> {
    try {
      const text = await this.platform.readUserFile("config.json");
      if (text) this.value = { ...DEFAULT_CONFIG, ...(JSON.parse(text) as Partial<AppConfig>) };
    } catch {
      /* first run / unreadable: defaults */
    }
  }

  /** Applies a patch, saves (in the background), and returns the previous value. */
  update(patch: Partial<AppConfig>): AppConfig {
    const prev = this.value;
    this.value = { ...prev, ...patch };
    this.platform.writeUserFile("config.json", JSON.stringify(this.value, null, 2)).catch((e) => console.error("could not save config", e));
    return prev;
  }
}
