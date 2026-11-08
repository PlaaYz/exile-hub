// Path of Building's engine on Tauri: the Rust side runs it in a child process (src-tauri/src/pob.rs);
// this picks the headless wrapper for the installed PoB version and handles timeouts/restarts.
import { invoke } from "@tauri-apps/api/core";
import type { PobEngineApi, PobEngineRequest } from "../app/platform";
import type { SuggestResult } from "../shared/types";

const kWrapperUrl = (v: string) =>
  `https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding/v${v}/src/HeadlessWrapper.lua`;
const kBootTimeoutMs = 60_000;
const kCallTimeoutMs = 60_000;

export interface PobFiles {
  userDir: string;
  pobVendorDir: string;
  fetchText(url: string, timeoutMs: number): Promise<string>;
  userFileAge(name: string): Promise<number | null>;
  writeUserFile(name: string, text: string): Promise<void>;
}

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export class TauriPob implements PobEngineApi {
  status: PobEngineApi["status"] = "off";
  private ready: Promise<void> | null = null;
  /** the build xml the engine has loaded (sent again only when it changes) */
  private engineKey: string | null = null;

  constructor(private readonly files: PobFiles) {}

  /** HeadlessWrapper.lua for the installed PoB version: cached download, else the bundled copy. */
  private async wrapperFor(version: string | null): Promise<string> {
    const f = this.files;
    const bundled = `${f.pobVendorDir}\\HeadlessWrapper.lua`;
    if (!version) return bundled;
    const name = `pob-HeadlessWrapper-${version}.lua`;
    const cached = `${f.userDir}\\${name}`;
    if ((await f.userFileAge(name)) !== null) return cached;
    try {
      const text = await f.fetchText(kWrapperUrl(version), 15_000);
      if (!text.includes('dofile("Launch.lua")')) throw new Error("unexpected wrapper content");
      await f.writeUserFile(name, text);
      return cached;
    } catch (e) {
      console.error("PoB wrapper download failed, using the bundled one", e);
      return bundled;
    }
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const pob = await invoke<{ dir: string; version: string | null } | null>("pob_find");
      if (!pob) {
        this.status = "missing-pob";
        throw new Error("Path of Building Community não encontrado neste PC.");
      }
      this.status = "starting";
      const wrapperPath = await this.wrapperFor(pob.version);
      const driverPath = `${this.files.pobVendorDir}\\exilehub.lua`;
      await withTimeout(
        invoke("pob_start", { pobDir: pob.dir, wrapperPath, driverPath }),
        kBootTimeoutMs,
        "o motor do PoB demorou demais para iniciar",
      );
      this.status = "ready";
    })().catch((e: unknown) => {
      const missing = this.status === "missing-pob";
      this.stop();
      this.status = missing ? "missing-pob" : "error";
      throw new Error(errorText(e));
    });
    return this.ready;
  }

  stop(): void {
    void invoke("pob_stop").catch(() => {});
    this.ready = null;
    this.engineKey = null;
    this.status = "off";
  }

  async suggest(req: PobEngineRequest): Promise<SuggestResult> {
    try {
      await this.start();
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
    // send the (large) build xml only when the engine does not have it yet
    const send = { ...req, xml: req.xmlKey === this.engineKey ? undefined : req.xml };
    let json: string;
    try {
      json = await withTimeout(invoke<string>("pob_call", { req: JSON.stringify(send) }), kCallTimeoutMs, "cálculo demorou demais");
    } catch (e) {
      const msg = errorText(e);
      // the worker died or was stopped: next request starts it again
      this.stop();
      return { ok: false, error: msg === "need-start" ? "o motor do PoB fechou" : msg };
    }
    let result: SuggestResult;
    try {
      result = JSON.parse(json) as SuggestResult;
    } catch {
      return { ok: false, error: "resposta inválida do motor do PoB" };
    }
    if (result.ok || result.error !== "need-xml") {
      if (result.ok) this.engineKey = req.xmlKey;
      return result;
    }
    this.engineKey = null; // engine restarted and lost the build: resend once
    return this.suggest(req);
  }
}
