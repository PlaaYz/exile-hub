import type { AppState, SessionView } from "../shared/types";
import { fmtChaos } from "./PriceView";

function dur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

function when(ts: number): string {
  return new Date(ts).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function chars(s: SessionView): string {
  if (!s.characters.length) return "—";
  return s.characters.map((c) => (c.to > c.from ? `${c.name} ${c.from}→${c.to}` : c.name)).join(", ");
}

function Current({ s, cpd }: { s: SessionView; cpd: number | null }) {
  return (
    <div className="map-current inside">
      <div className="row" style={{ margin: 0 }}>
        <b style={{ flex: 1 }}>Sessão atual</b>
        <span className="muted small">desde {when(s.start)}</span>
      </div>
      <div className="big">{dur(s.durationMs)}</div>
      <div className="session-stats">
        <span>
          <b>{s.maps}</b> mapas
        </span>
        <span>
          <b>{s.bossRuns}</b> bosses
        </span>
        <span className={s.deaths ? "warn-text" : ""}>
          <b>{s.deaths}</b> mortes
        </span>
        <span>
          <b>{s.zones}</b> zonas
        </span>
        <span>
          <b>{s.passives}</b> passivos
        </span>
        <span>
          <b>{s.priceChecks}</b> itens precificados
        </span>
      </div>
      <div className="small">Personagens: {chars(s)}</div>
      {s.earnings && (
        <div className="small">
          Rendimento esperado dos bosses e T17: <b><EarningsText e={s.earnings} cpd={cpd} /></b>{" "}
          <span className="muted">({s.earnings.lines.map((l) => `${l.count}× ${l.name}`).join(", ")})</span>
        </div>
      )}
      {s.bestPrice && (
        <div className="small">
          Item mais valioso que você copiou: <b>{s.bestPrice.name}</b> ({fmtChaos(s.bestPrice.chaos, cpd)})
        </div>
      )}
    </div>
  );
}

type Earnings = AppState["sessions"]["recent"][number]["earnings"];

const signedChaos = (c: number, cpd: number | null) => `${c < 0 ? "−" : "+"}${fmtChaos(Math.abs(c), cpd)}`;

/** "+3.2 div" with the boss fights / T17 maps it came from on hover. */
function EarningsText({ e, cpd }: { e: Earnings; cpd: number | null }) {
  if (!e) return <span className="muted">—</span>;
  const detail = e.lines.map((l) => `${l.count}× ${l.name}: ${signedChaos(l.each, cpd)} cada`).join("\n");
  return (
    <span className={e.chaos < 0 ? "warn-text" : "good-text"} title={detail + (e.incomplete ? "\n(alguns drops sem preço contam como 0)" : "")}>
      {signedChaos(e.chaos, cpd)}
    </span>
  );
}

export function SessionsPanelBody({ state }: { state: AppState }) {
  const cur = state.sessions.current;
  const cpd = state.sessions.chaosPerDivine ?? state.price?.chaosPerDivine ?? null;
  return (
    <>
      {cur ? <Current s={cur} cpd={cpd} /> : <p className="muted small">O jogo está fechado. Quando abrir, a sessão aparece aqui ao vivo.</p>}
      <h3>Sessões anteriores</h3>
      {state.sessions.recent.length === 0 ? (
        <p className="muted small">Nenhuma sessão no Client.txt ainda.</p>
      ) : (
        <table className="farm-items">
          <thead>
            <tr>
              <th>Quando</th>
              <th className="num-cell">Duração</th>
              <th className="num-cell">Mapas</th>
              <th className="num-cell">Bosses</th>
              <th className="num-cell">Mortes</th>
              <th className="num-cell" title="valor esperado dos bosses e mapas T17 feitos (média da aba Farm)">
                Rendimento
              </th>
              <th>Personagens</th>
            </tr>
          </thead>
          <tbody>
            {state.sessions.recent.map((s) => (
              <tr key={s.start}>
                <td className="small">
                  {when(s.start)}
                  {s.abrupt && <span className="muted"> · sem fechamento</span>}
                </td>
                <td className="num-cell">{dur(s.durationMs)}</td>
                <td className="num-cell">{s.maps || "—"}</td>
                <td className="num-cell">{s.bossRuns || "—"}</td>
                <td className={`num-cell${s.deaths ? " warn-text" : " muted"}`}>{s.deaths || "—"}</td>
                <td className="num-cell">
                  <EarningsText e={s.earnings} cpd={cpd} />
                </td>
                <td className="small">
                  {chars(s)}
                  {s.priceChecks > 0 && <div className="muted">{s.priceChecks} itens precificados</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">
        Uma sessão vai de abrir o jogo até fechá-lo, tudo lido do Client.txt (por isso as antigas também aparecem). Ao
        fechar o jogo, o resumo aparece numa notificação do Windows. "Sem fechamento" = o jogo travou ou foi encerrado à
        força. Itens precificados só contam enquanto o Exile Hub estava aberto. Rendimento = valor esperado (média da aba Farm,
        com preços de agora) dos bosses e mapas T17 que você fez; os outros mapas não entram, porque o log não mostra os drops.
      </p>
    </>
  );
}
