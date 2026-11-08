// Main-process side of the Path of Building engine: finds the user's PoB install, picks the
// headless wrapper matching its version, and talks to the engine running in a utilityProcess.
import { app, utilityProcess, type UtilityProcess } from "electron";
import fs from "node:fs";
import path from "node:path";

import type { SuggestResult } from "../shared/types";
import { findPob } from "./luaHost";
export type { SuggestResult };

export interface SuggestRequest {
  xml?: string;
  xmlKey: string;
  level: number;
  /** our gem id (exile-leveling) + name; the engine maps them to PoB ids */
  candidates: { id: string; name: string }[];
  maxSupports: number;
}

const kWrapperUrl = (v: string) =>
  `https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding/v${v}/src/HeadlessWrapper.lua`;
const kBootTimeoutMs = 60_000;
const kCallTimeoutMs = 60_000;

export class PobEngine {
  private proc: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: SuggestResult) => void; timer: NodeJS.Timeout }>();
  /** the build xml the engine has loaded (sent again only when it changes) */
  private engineKey: string | null = null;
  status: "off" | "starting" | "ready" | "missing-pob" | "error" = "off";
  error: string | null = null;
  pob: { dir: string; version: string | null } | null = null;

  constructor(
    private readonly vendorDir: string,
    private readonly workerPath: string,
    private readonly userAgent: string,
  ) {}

  /** HeadlessWrapper.lua for the installed PoB version: cached download, else the bundled copy. */
  private async wrapperFor(version: string | null): Promise<string> {
    const bundled = path.join(this.vendorDir, "HeadlessWrapper.lua");
    if (!version) return bundled;
    const cached = path.join(app.getPath("userData"), `pob-HeadlessWrapper-${version}.lua`);
    if (fs.existsSync(cached)) return cached;
    try {
      const res = await fetch(kWrapperUrl(version), {
        headers: { "User-Agent": this.userAgent },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes('dofile("Launch.lua")')) throw new Error("unexpected wrapper content");
      fs.writeFileSync(cached, text);
      return cached;
    } catch (e) {
      console.error("PoB wrapper download failed, using the bundled one", e);
      return bundled;
    }
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.pob = findPob();
    if (!this.pob) {
      this.status = "missing-pob";
      this.error = "Path of Building Community não encontrado neste PC.";
      return Promise.reject(new Error(this.error));
    }
    const pob = this.pob;
    this.status = "starting";
    this.ready = (async () => {
      const wrapperPath = await this.wrapperFor(pob.version);
      const proc = utilityProcess.fork(this.workerPath, [], { serviceName: "Exile Hub PoB engine", stdio: "ignore" });
      this.proc = proc;
      proc.on("exit", () => this.onExit());
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("o motor do PoB demorou demais para iniciar")), kBootTimeoutMs);
        proc.on("message", (msg: { type: string; id?: number; json?: string; error?: string }) => {
          if (msg.type === "ready") {
            clearTimeout(timer);
            resolve();
          } else if (msg.type === "error" && msg.id === undefined) {
            clearTimeout(timer);
            reject(new Error(msg.error));
          } else if (msg.id !== undefined) {
            this.settle(msg.id, msg.type === "result" ? safeParse(msg.json) : { ok: false, error: msg.error });
          }
        });
        proc.postMessage({ type: "init", pobDir: pob.dir, wrapperPath, driverPath: path.join(this.vendorDir, "exilehub.lua") });
      });
      this.status = "ready";
      this.error = null;
    })().catch((e: Error) => {
      this.status = "error";
      this.error = e.message;
      this.stop();
      throw e;
    });
    return this.ready;
  }

  private settle(id: number, r: SuggestResult): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(r);
  }

  private onExit(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, { ok: false, error: "o motor do PoB fechou" });
    this.proc = null;
    this.ready = null;
    this.engineKey = null;
    if (this.status === "ready") this.status = "off";
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
    this.ready = null;
    this.engineKey = null;
  }

  async suggest(req: SuggestRequest): Promise<SuggestResult> {
    try {
      await this.start();
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const proc = this.proc;
    if (!proc) return { ok: false, error: "motor do PoB indisponível" };
    // send the (large) build xml only when the engine does not have it yet
    const send = { ...req, xml: req.xmlKey === this.engineKey ? undefined : req.xml };
    const id = this.nextId++;
    const result = await new Promise<SuggestResult>((resolve) => {
      const timer = setTimeout(() => this.settle(id, { ok: false, error: "cálculo demorou demais" }), kCallTimeoutMs);
      this.pending.set(id, { resolve, timer });
      proc.postMessage({ type: "suggest", id, req: send });
    });
    if (result.ok || result.error !== "need-xml") {
      if (result.ok) this.engineKey = req.xmlKey;
      return result;
    }
    this.engineKey = null; // engine restarted and lost the build: resend once
    return this.suggest(req);
  }
}

function safeParse(json: string | undefined): SuggestResult {
  try {
    return JSON.parse(json ?? "") as SuggestResult;
  } catch {
    return { ok: false, error: "resposta inválida do motor do PoB" };
  }
}
