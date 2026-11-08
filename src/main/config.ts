// The settings file (userData/config.json).
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../shared/types";
import { readJson, userFile } from "./env";
import { DEFAULT_CONFIG } from "./ipcClean";

export class ConfigStore {
  value: AppConfig = { ...DEFAULT_CONFIG };
  private readonly file = userFile("config.json");

  load(): void {
    try {
      this.value = { ...DEFAULT_CONFIG, ...readJson<Partial<AppConfig>>(this.file) };
    } catch {
      /* first run */
    }
  }

  /** Applies a patch, saves, and returns the previous value. */
  update(patch: Partial<AppConfig>): AppConfig {
    const prev = this.value;
    this.value = { ...prev, ...patch };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.value, null, 2));
    } catch (e) {
      console.error("could not save config", e);
    }
    return prev;
  }
}
