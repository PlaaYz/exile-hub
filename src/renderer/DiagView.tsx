import { useState } from "react";
import type { AppState } from "../shared/types";

function ago(ts: number | null): string {
  if (!ts) return "nunca";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `há ${m} min` : `há ${Math.round(m / 60)} h`;
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
        <Status ok={logOk} label="Client.txt" detail={`${state.logStatus} · última linha ${ago(d.lastLineAt)} · ${d.linesSeen} linhas`} />
        <Status ok={d.gameRunning ? true : null} label="Jogo" detail={d.gameRunning ? (d.gameFocused ? "aberto, em foco" : "aberto, sem foco") : "fechado (ou ainda não visto)"} />
        <Status
          ok={state.config.overlayEnabled ? d.overlayVisible || !d.gameFocused : null}
          label="Overlay"
          detail={!state.config.overlayEnabled ? "desligado (F9)" : d.overlayVisible ? "visível" : "escondido"}
        />
        <Status ok={d.clipboardWatch} label="Price check" detail={d.clipboardWatch ? `ligado · liga ${state.league ?? "?"}` : "desligado"} />
        <Status
          ok={state.characterName ? true : null}
          label="Personagem"
          detail={state.characterName ? `${state.characterName} (${state.className}, nível ${state.characterLevel})` : "desconhecido até subir de nível"}
        />
        <Status ok={state.areaName ? true : null} label="Zona" detail={`${state.areaName ?? "?"} · rota ${state.tracker.cursor}/${state.tracker.total}`} />
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
          Copiar relatório
        </button>
        <span className="muted small">
          {copied ? "Copiado! Cole na conversa com o Claude." : `versão ${d.version} · cole o relatório na conversa para eu analisar`}
        </span>
      </div>

      <h3>O que o app entendeu (mais recente primeiro)</h3>
      {d.entries.length === 0 ? (
        <p className="muted small">Nada ainda. Abra o jogo, troque de zona, copie um item com Ctrl+C: tudo aparece aqui.</p>
      ) : (
        <ul className="diag-feed">
          {d.entries.map((e, i) => (
            <li key={`${e.ts}-${i}`}>
              <span className="muted small diag-time">{new Date(e.ts).toLocaleTimeString("pt-BR")}</span>
              <span className={`diag-kind ${KIND_CLASS[e.kind] ?? ""}`}>{e.kind}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Só aparecem eventos do jogo e o que o app fez com eles. Textos que você copia e não são item nem build do PoB
        não são registrados.
      </p>
    </>
  );
}
