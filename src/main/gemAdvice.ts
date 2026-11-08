// "Best next support gems" for the campaign, computed by Path of Building's engine.
import { createHash } from "node:crypto";
import { baseClass } from "../core/classes";
import type { DiagKind } from "../core/diag";
import { availableSupports, sourceText, type GemInfo, type QuestInfo } from "../core/gemAvailability";
import { decodePobCode } from "../core/pob";
import type { Session } from "../core/session";
import type { AppConfig, AppState, PobBuild } from "../shared/types";
import { kAdviceDebounceMs, kGemAdviceMaxLevel, kUserAgent, pobVendorDir } from "./env";
import path from "node:path";
import { PobEngine } from "./pobEngine";

export interface GemAdviceContext {
  config(): AppConfig;
  session(): Session;
  build(): PobBuild | null;
  gemsData: Record<string, GemInfo>;
  quests: Record<string, QuestInfo>;
  broadcast(): void;
  addDiag(kind: DiagKind, text: string): void;
}

export class GemAdviceService {
  private readonly engine = new PobEngine(pobVendorDir, path.join(__dirname, "pobWorker.js"), kUserAgent);
  private xml: string | null = null;
  private xmlKey: string | null = null;
  state: AppState["gemAdvice"] = { status: "off", message: null, mismatch: null, level: null, act: null, result: null, sources: {}, at: null };
  private key = "";
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly ctx: GemAdviceContext) {}

  /** The PoB code of the current build (the engine needs its XML). */
  setBuildCode(code: string): void {
    try {
      this.xml = decodePobCode(code);
      this.xmlKey = createHash("sha1").update(this.xml).digest("hex").slice(0, 16);
    } catch {
      this.xml = null;
      this.xmlKey = null;
    }
    this.maybeAdvise();
  }

  stop(): void {
    this.engine.stop();
  }

  private set(patch: Partial<AppState["gemAdvice"]>): void {
    this.state = { ...this.state, ...patch };
    this.ctx.broadcast();
  }

  /** Base class of the character being played (log), else the build's class. */
  private playerClass(): string {
    return baseClass(this.ctx.session().className) ?? this.ctx.build()?.className ?? "Scion";
  }

  /**
   * Recompute when the level, the act or the build changed (campaign only). Debounced: zone
   * changes come in bursts; the engine takes ~1-3 s per full ranking.
   */
  maybeAdvise(force = false): void {
    const session = this.ctx.session();
    const level = session.characterLevel;
    const act = session.tracker.view().act || 1;
    if (!this.ctx.config().gemAdviceEnabled) {
      if (this.state.status !== "off") this.set({ status: "off", message: "desligado nas configurações" });
      return;
    }
    if (!this.ctx.build() || !this.xml) {
      if (this.state.status !== "no-build") this.set({ status: "no-build", message: "importe um build do PoB" });
      return;
    }
    if (level === null) {
      if (this.state.status !== "waiting") this.set({ status: "waiting", message: "aguardando o personagem subir de nível" });
      return;
    }
    if (level > kGemAdviceMaxLevel) {
      if (this.state.status !== "not-campaign") {
        this.set({ status: "not-campaign", message: `só na campanha (até o nível ${kGemAdviceMaxLevel})`, level, act });
      }
      return;
    }
    const key = `${this.xmlKey}|${this.playerClass()}|${level}|${act}`;
    if (!force && key === this.key) return;
    this.key = key;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(level, act), force ? 0 : kAdviceDebounceMs);
  }

  private async run(level: number, act: number): Promise<void> {
    if (this.running) {
      this.timer = setTimeout(() => void this.run(level, act), kAdviceDebounceMs);
      return;
    }
    const build = this.ctx.build();
    const xml = this.xml;
    const xmlKey = this.xmlKey;
    if (!build || !xml || !xmlKey) return;
    // gems you can get depend on the class you play (quest rewards); the skill comes from the build
    const avail = availableSupports(this.ctx.gemsData, this.ctx.quests, this.playerClass(), act, level);
    const sources: Record<string, string> = {};
    for (const g of avail) sources[g.id] = sourceText(g.source);
    const played = this.ctx.session().className;
    const mismatch =
      played && baseClass(played) !== build.className ? `o build importado é de ${build.className} e você está jogando ${played}` : null;
    this.running = true;
    this.set({ status: "computing", message: `calculando com o motor do PoB (${avail.length} suportes disponíveis)…`, level, act, mismatch });
    try {
      const r = await this.engine.suggest({
        xml,
        xmlKey,
        level,
        candidates: avail.map((g) => ({ id: g.id, name: g.name })),
        maxSupports: 3,
      });
      if (r.ok) {
        if (r.singles) r.singles = r.singles.slice(0, 10);
        this.set({ status: "ok", message: null, level, act, result: r, sources, at: Date.now() });
        const best = r.singles?.[0];
        this.ctx.addDiag(
          "app",
          best ? `suporte sugerido: ${best.name} (+${Math.round(best.gain * 100)}% DPS) em ${r.ms} ms` : "nenhum suporte disponível aumenta o DPS",
        );
      } else {
        // "skill needs level X" is a normal wait, not an error
        const status = this.engine.status === "missing-pob" ? "no-pob" : r.soft ? "waiting" : "error";
        this.set({ status, message: r.error ?? "erro", level, act, result: null, at: Date.now() });
        this.ctx.addDiag("app", r.soft ? `sugestão de gemas: ${r.error}` : `sugestão de gemas falhou: ${r.error}`);
      }
    } finally {
      this.running = false;
    }
  }
}
