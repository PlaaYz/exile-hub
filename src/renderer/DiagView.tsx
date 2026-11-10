import { useState } from "react";
import { locale, tr } from "../shared/i18n";
import type { AppState } from "../shared/types";

function ago(ts: number | null): string {
  if (!ts) return tr("nunca", "never");
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  const t = s < 60 ? `${s} s` : Math.round(s / 60) < 60 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
  return tr(`há ${t}`, `${t} ago`);
}

function Status({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  const cls = ok === null ? "" : ok ? "good" : "warn-text";
  return (
    <div className="diag-status">
      <span className={`dot ${ok === null ? "" : ok ? "watching" : "error"}`} />
      <span>{label}</span>
      <span className={`small ${cls || "muted"}`}>{detail}</span>
    </div>
  );
}

/** The diagnostic kinds are pt-BR ids; this is how they read in English. */
const KIND_EN: Record<string, string> = {
  zona: "zone",
  personagem: "character",
  jogo: "game",
  passivo: "passive",
  mapa: "map",
  preço: "price",
};

const KIND_CLASS: Record<string, string> = {
  zona: "f-enter",
  personagem: "f-quest",
  jogo: "f-wp",
  passivo: "f-asc",
  mapa: "f-craft",
  boss: "f-kill",
  overlay: "muted",
  clipboard: "f-vendor",
  preço: "f-quest",
  app: "muted",
};

export function DiagPanelBody({ state }: { state: AppState }) {
  const d = state.diag;
  const [copied, setCopied] = useState(false);
  const logOk = state.logStatus === "watching";
  return (
    <>
      <div className="diag-grid">
        <Status ok={logOk} label="Client.txt" detail={`${state.logStatus} · ${tr("última linha", "last line")} ${ago(d.lastLineAt)} · ${d.linesSeen} ${tr("linhas", "lines")}`} />
        <Status ok={d.gameRunning ? true : null} label={tr("Jogo", "Game")} detail={d.gameRunning ? (d.gameFocused ? tr("aberto, em foco", "running, focused") : tr("aberto, sem foco", "running, unfocused")) : tr("fechado (ou ainda não visto)", "closed (or not seen yet)")} />
        <Status
          ok={state.config.overlayEnabled ? d.overlayVisible || !d.gameFocused : null}
          label="Overlay"
          detail={!state.config.overlayEnabled ? tr("desligado (F9)", "off (F9)") : d.overlayVisible ? tr("visível", "visible") : tr("escondido", "hidden")}
        />
        <Status ok={d.clipboardWatch} label="Price check" detail={d.clipboardWatch ? `${tr("ligado · liga", "on · league")} ${state.league ?? "?"}` : tr("desligado", "off")} />
        <Status
          ok={state.characterName ? true : null}
          label={tr("Personagem", "Character")}
          detail={state.characterName ? `${state.characterName} (${state.className}, ${tr("nível", "level")} ${state.characterLevel})` : tr("desconhecido até subir de nível", "unknown until it levels up")}
        />
        <Status ok={state.areaName ? true : null} label={tr("Zona", "Zone")} detail={`${state.areaName ?? "?"} · ${tr("rota", "route")} ${state.tracker.cursor}/${state.tracker.total}`} />
      </div>

      <div className="row buttons">
        <button
          onClick={() => {
            void window.hub.copyDiagReport().then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 3000);
            });
          }}
        >
          {tr("Copiar relatório", "Copy report")}
        </button>
        <span className="muted small">
          {copied ? tr("Copiado! Cole numa issue do GitHub.", "Copied! Paste it into a GitHub issue.") : `${tr("versão", "version")} ${d.version} · ${tr("cole o relatório numa issue do GitHub", "paste the report into a GitHub issue")}`}
        </span>
      </div>

      <h3>{tr("O que o app entendeu (mais recente primeiro)", "What the app understood (newest first)")}</h3>
      {d.entries.length === 0 ? (
        <p className="muted small">{tr("Nada ainda. Abra o jogo, troque de zona, copie um item com Ctrl+C: tudo aparece aqui.", "Nothing yet. Start the game, change zones, copy an item with Ctrl+C: everything shows up here.")}</p>
      ) : (
        <ul className="diag-feed">
          {d.entries.map((e, i) => (
            <li key={`${e.ts}-${i}`}>
              <span className="muted small diag-time">{new Date(e.ts).toLocaleTimeString(locale())}</span>
              <span className={`diag-kind ${KIND_CLASS[e.kind] ?? ""}`}>{tr(e.kind, KIND_EN[e.kind] ?? e.kind)}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        {tr(
          "Só aparecem eventos do jogo e o que o app fez com eles. Textos que você copia e não são item nem build do PoB não são registrados.",
          "Only game events and what the app did with them show up. Text you copy that is neither an item nor a PoB build is not recorded.",
        )}
      </p>
    </>
  );
}
