// Lab tab: the run in progress, today's rooms learned from the player's own runs, times and profit per
// run (the log has no drops: gain and cost are typed). Overlay line: LabHint.
import { useEffect, useState } from "react";
import { labName, type LabAggregate, type LabStats } from "../core/lab";
import { locale, tr } from "../shared/i18n";
import { load, NumInput, save } from "./FarmView";
import { fmtMs } from "./hooks";

const LS = "exile-hub.lab.v1";
/** chaos per run, by lab level */
type Money = Record<string, { gain?: number; cost?: number }>;

const ms = (v: number | null) => (v === null ? "—" : fmtMs(v));

function where(c: NonNullable<LabStats["current"]>): string {
  if (c.final) return tr("luta final do Izaro", "final Izaro fight");
  if (c.inFight) return tr(`${c.fight}ª luta do Izaro`, `Izaro fight ${c.fight}`);
  return c.room;
}

export function LabHint({ lab }: { lab: LabStats }) {
  const c = lab.current;
  if (!c) return null;
  return (
    <div className="ov-map-box">
      <div className="ov-map">
        <span>
          <b>Lab {labName(c.level)}</b> · {fmtMs(c.ms)} · {where(c)}
          {c.deaths ? <span className="warn-text"> · {c.deaths}✝</span> : null}
        </span>
      </div>
      <div className="ov-map-stats muted">
        {!c.inFight && `${tr("próxima luta", "next fight")}: ${Math.min(c.fight + 1, 3)}/3`}
        {c.next && `${c.inFight ? "" : " · "}${c.next === "Izaro" ? tr("depois: Izaro", "then: Izaro") : `${tr("próxima sala", "next room")}: ${c.next}`}`}
      </div>
    </div>
  );
}

function perHour(a: LabAggregate): number | null {
  return a.avgMs ? 3_600_000 / a.avgMs : null;
}

export function LabPanelBody({ lab }: { lab: LabStats }) {
  const [money, setMoney] = useState<Money>(() => load(LS, {}));
  useEffect(() => save(LS, money), [money]);
  const set = (level: number, k: "gain" | "cost", v: number | undefined) =>
    setMoney((m) => ({ ...m, [level]: { ...m[level], [k]: v } }));
  const c = lab.current;
  const today = new Map(lab.today.map((a) => [a.level, a]));
  return (
    <>
      {c && (
        <div className="map-current inside">
          <div>
            <b>Lab {labName(c.level)}</b> <span className="muted">· {where(c)}</span>
          </div>
          <div className="big">{fmtMs(c.ms)}</div>
          <div className="muted small">
            {tr(`lutas do Izaro: ${c.fight} de 3`, `Izaro fights: ${c.fight} of 3`)}
            {c.next ? ` · ${c.next === "Izaro" ? tr("depois: Izaro", "then: Izaro") : `${tr("próxima sala", "next room")}: ${c.next}`}` : ""}
            {c.deaths ? ` · ${c.deaths} ${tr("morte(s)", "death(s)")}` : ""}
          </div>
        </div>
      )}

      <h3>{tr("Caminho de hoje", "Today's way")}</h3>
      {lab.layouts.length === 0 ? (
        <p className="muted small">
          {tr(
            "Faça uma run: o app aprende as salas e mostra nas próximas do mesmo dia. O Lab muda às 00:00 UTC (21:00 em Brasília).",
            "Do one run: the app learns the rooms and shows them on the next runs of the same day. The Lab changes at 00:00 UTC.",
          )}
        </p>
      ) : (
        lab.layouts.map((l) => (
          <div key={l.level} className="lab-way">
            <b>{labName(l.level)}</b>
            {l.sections.map((rooms, i) => (
              <div key={i} className="small">
                <span className="muted">{i + 1}. </span>
                {rooms === null ? <span className="muted">{tr("ainda não feito hoje", "not done today yet")}</span> : [...rooms, "Izaro"].join(" → ")}
              </div>
            ))}
          </div>
        ))
      )}
      <div className="row">
        <button onClick={() => void window.hub.openLabSite()}>{tr("Abrir o mapa do dia no poelab.com", "Open today's map on poelab.com")}</button>
        <span className="muted small">
          {tr("O log mostra só as salas em que você entrou, não as portas nem os baús.", "The log only shows the rooms you entered, not the doors or chests.")}
        </span>
      </div>

      <h3>{tr("Suas runs", "Your runs")}</h3>
      {lab.byLevel.length === 0 ? (
        <p className="muted small">{tr("Nenhuma run de Lab no Client.txt ainda.", "No Lab runs in Client.txt yet.")}</p>
      ) : (
        <>
          <table className="farm-items">
            <thead>
              <tr>
                <th>Lab</th>
                <th className="num-cell">Runs</th>
                <th className="num-cell">{tr("Hoje", "Today")}</th>
                <th className="num-cell">{tr("Até a final", "To the final")}</th>
                <th className="num-cell">{tr("Melhor", "Best")}</th>
                <th className="num-cell">{tr("Run inteira", "Whole run")}</th>
                <th className="num-cell">Runs/h</th>
                <th className="num-cell">{tr("Mortes", "Deaths")}</th>
              </tr>
            </thead>
            <tbody>
              {lab.byLevel.map((a) => (
                <tr key={a.level}>
                  <td>{labName(a.level)}</td>
                  <td className="num-cell">
                    {a.finished}
                    {a.runs > a.finished && <span className="muted">/{a.runs}</span>}
                  </td>
                  <td className="num-cell">{today.get(a.level)?.finished ?? 0}</td>
                  <td className="num-cell">{ms(a.avgToFinalMs)}</td>
                  <td className="num-cell">{ms(a.bestToFinalMs)}</td>
                  <td className="num-cell">{ms(a.avgMs)}</td>
                  <td className="num-cell">{perHour(a)?.toFixed(1) ?? "—"}</td>
                  <td className={`num-cell${a.deaths ? " warn-text" : " muted"}`}>{a.deaths || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>{tr("Lucro por run", "Profit per run")}</h3>
          <table className="farm-items">
            <thead>
              <tr>
                <th>Lab</th>
                <th>{tr("Ganho médio (c)", "Average gain (c)")}</th>
                <th>{tr("Custo (c)", "Cost (c)")}</th>
                <th className="num-cell">{tr("Lucro/run", "Profit/run")}</th>
                <th className="num-cell">{tr("Lucro/h", "Profit/h")}</th>
              </tr>
            </thead>
            <tbody>
              {lab.byLevel.map((a) => {
                const m = money[a.level] ?? {};
                const profit = m.gain === undefined ? null : m.gain - (m.cost ?? 0);
                const rate = perHour(a);
                const cls = (v: number | null) => `num-cell${v === null ? " muted" : v < 0 ? " warn-text" : " good-text"}`;
                const hour = profit !== null && rate !== null ? profit * rate : null;
                return (
                  <tr key={a.level}>
                    <td>{labName(a.level)}</td>
                    <td>
                      <NumInput value={m.gain} placeholder="?" onChange={(v) => set(a.level, "gain", v)} />
                    </td>
                    <td>
                      <NumInput value={m.cost} placeholder="0" onChange={(v) => set(a.level, "cost", v)} />
                    </td>
                    <td className={cls(profit)}>{profit === null ? "—" : `${Math.round(profit)} c`}</td>
                    <td className={cls(hour)}>{hour === null ? "—" : `${Math.round(hour)} c`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">
            {tr("O log não mostra os drops: digite quanto uma run rende em média e o custo da entrada (oferenda). O lucro por hora usa o tempo médio das suas runs.", "The log has no drops: type what a run yields on average and the entry cost (offering). Profit per hour uses your runs' average time.")}
          </p>

          <h3>{tr("Últimas runs", "Recent runs")}</h3>
          <table className="farm-items">
            <tbody>
              {lab.recent.map((r) => (
                <tr key={r.start}>
                  <td>{labName(r.level)}</td>
                  <td className={r.finished ? "good-text" : "muted"}>{r.finished ? tr("concluída", "finished") : tr(`parou (${r.fights}/3 lutas)`, `stopped (${r.fights}/3 fights)`)}</td>
                  <td className="num-cell">{fmtMs(r.ms)}</td>
                  <td className={`num-cell${r.deaths ? " warn-text" : " muted"}`}>{r.deaths ? `${r.deaths}✝` : "—"}</td>
                  <td className="num-cell muted small">
                    {new Date(r.start).toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            {tr('"Concluída" = chegou à luta final e saiu sem morrer nela (o log não avisa quando o Izaro cai).', '"Finished" = reached the final fight and left without dying in it (the log does not say when Izaro falls).')}
          </p>
        </>
      )}
    </>
  );
}
