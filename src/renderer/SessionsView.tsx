import { locale, tr } from "../shared/i18n";
import type { AppState, SessionView } from "../shared/types";
import { fmtChaos } from "./PriceView";

function dur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

function when(ts: number): string {
  return new Date(ts).toLocaleString(locale(), { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function chars(s: SessionView): string {
  if (!s.characters.length) return "—";
  return s.characters.map((c) => (c.to > c.from ? `${c.name} ${c.from}→${c.to}` : c.name)).join(", ");
}

function Current({ s, cpd }: { s: SessionView; cpd: number | null }) {
  return (
    <div className="map-current inside">
      <div className="row" style={{ margin: 0 }}>
        <b style={{ flex: 1 }}>{tr("Sessão atual", "Current session")}</b>
        <span className="muted small">{tr("desde", "since")} {when(s.start)}</span>
      </div>
      <div className="big">{dur(s.durationMs)}</div>
      <div className="session-stats">
        <span>
          <b>{s.maps}</b> {tr("mapas", "maps")}
        </span>
        <span>
          <b>{s.bossRuns}</b> bosses
        </span>
        <span className={s.deaths ? "warn-text" : ""}>
          <b>{s.deaths}</b> {tr("mortes", "deaths")}
        </span>
        <span>
          <b>{s.zones}</b> {tr("zonas", "zones")}
        </span>
        <span>
          <b>{s.passives}</b> {tr("passivos", "passives")}
        </span>
        <span>
          <b>{s.priceChecks}</b> {tr("itens precificados", "items priced")}
        </span>
      </div>
      <div className="small">{tr("Personagens", "Characters")}: {chars(s)}</div>
      {s.earnings && (
        <div className="small">
          {tr("Rendimento esperado dos bosses e T17:", "Expected earnings from bosses and T17:")} <b><EarningsText e={s.earnings} cpd={cpd} /></b>{" "}
          <span className="muted">({s.earnings.lines.map((l) => `${l.count}× ${l.name}`).join(", ")})</span>
        </div>
      )}
      {s.bestPrice && (
        <div className="small">
          {tr("Item mais valioso que você copiou:", "Most valuable item you copied:")} <b>{s.bestPrice.name}</b> ({fmtChaos(s.bestPrice.chaos, cpd)})
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
  const detail = e.lines.map((l) => `${l.count}× ${l.name}: ${signedChaos(l.each, cpd)} ${tr("cada", "each")}`).join("\n");
  return (
    <span className={e.chaos < 0 ? "warn-text" : "good-text"} title={detail + (e.incomplete ? tr("\n(alguns drops sem preço contam como 0)", "\n(some drops without a price count as 0)") : "")}>
      {signedChaos(e.chaos, cpd)}
    </span>
  );
}

export function SessionsPanelBody({ state }: { state: AppState }) {
  const cur = state.sessions.current;
  const cpd = state.sessions.chaosPerDivine ?? state.price?.chaosPerDivine ?? null;
  return (
    <>
      {cur ? <Current s={cur} cpd={cpd} /> : <p className="muted small">{tr("O jogo está fechado. Quando abrir, a sessão aparece aqui ao vivo.", "The game is closed. When it starts, the session shows up here live.")}</p>}
      <h3>{tr("Sessões anteriores", "Previous sessions")}</h3>
      {state.sessions.recent.length === 0 ? (
        <p className="muted small">{tr("Nenhuma sessão no Client.txt ainda.", "No sessions in Client.txt yet.")}</p>
      ) : (
        <table className="farm-items">
          <thead>
            <tr>
              <th>{tr("Quando", "When")}</th>
              <th className="num-cell">{tr("Duração", "Duration")}</th>
              <th className="num-cell">{tr("Mapas", "Maps")}</th>
              <th className="num-cell">Bosses</th>
              <th className="num-cell">{tr("Mortes", "Deaths")}</th>
              <th className="num-cell" title={tr("valor esperado dos bosses e mapas T17 feitos (média da aba Farm)", "expected value of the bosses and T17 maps run (Farm tab average)")}>
                {tr("Rendimento", "Earnings")}
              </th>
              <th>{tr("Personagens", "Characters")}</th>
            </tr>
          </thead>
          <tbody>
            {state.sessions.recent.map((s) => (
              <tr key={s.start}>
                <td className="small">
                  {when(s.start)}
                  {s.abrupt && <span className="muted"> · {tr("sem fechamento", "no clean exit")}</span>}
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
                  {s.priceChecks > 0 && <div className="muted">{s.priceChecks} {tr("itens precificados", "items priced")}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">
        {tr(
          'Uma sessão vai de abrir o jogo até fechá-lo, tudo lido do Client.txt (por isso as antigas também aparecem). Ao fechar o jogo, o resumo aparece numa notificação do Windows. "Sem fechamento" = o jogo travou ou foi encerrado à força. Itens precificados só contam enquanto o Exile Hub estava aberto. Rendimento = valor esperado (média da aba Farm, com preços de agora) dos bosses e mapas T17 que você fez; os outros mapas não entram, porque o log não mostra os drops.',
          'A session runs from starting the game to closing it, all read from Client.txt (so old ones show up too). When the game closes, a Windows notification shows the summary. "No clean exit" = the game crashed or was killed. Priced items only count while Exile Hub was running. Earnings = expected value (Farm tab average, at current prices) of the bosses and T17 maps you ran; other maps are left out because the log does not show drops.',
        )}
      </p>
    </>
  );
}
