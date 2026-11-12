import type { MapAggregate, MapStats } from "../core/maps";
import { locale, tr } from "../shared/i18n";
import { fmtMs } from "./hooks";

function perHour(a: MapAggregate): string {
  return a.mapsPerHour === null ? "—" : a.mapsPerHour.toFixed(1);
}

function Aggregate({ title, a }: { title: string; a: MapAggregate | null }) {
  return (
    <div className="map-agg">
      <div className="map-agg-title">{title}</div>
      {a ? (
        <>
          <div className="big-sm">{a.maps}</div>
          <div className="muted small">{tr("mapas", "maps")}</div>
          <div className="map-agg-row">
            <span>{fmtMs(a.avgMapMs)}</span>
            <span className="muted small">{tr("média no mapa", "avg in map")}</span>
          </div>
          <div className="map-agg-row">
            <span>{perHour(a)}</span>
            <span className="muted small">{tr("mapas/hora", "maps/hour")}</span>
          </div>
          <div className="map-agg-row">
            <span>{fmtMs(a.ms - a.inMapMs)}</span>
            <span className="muted small">{tr("fora do mapa", "out of maps")}</span>
          </div>
          <div className="map-agg-row">
            <span className={a.deaths ? "warn-text" : ""}>{a.deaths}</span>
            <span className="muted small">{tr("mortes", "deaths")}</span>
          </div>
        </>
      ) : (
        <div className="muted small">{tr("nenhum mapa", "no maps")}</div>
      )}
    </div>
  );
}

/** Overlay line while mapping: current map, its timer and today's count. */
/** Overlay: the map you are in (or the last one), then this session's count and average time. */
export function MapHint({ maps }: { maps: MapStats }) {
  const c = maps.current;
  const s = maps.session;
  if (!c && !s) return null;
  return (
    <div className="ov-map-box">
      {c && (
        <div className="ov-map">
          <span>
            <b>{c.name}</b> T{c.tier} · {fmtMs(c.inMapMs)}
            {c.deaths ? <span className="warn-text"> · {c.deaths}✝</span> : null}
            {c.mechanics.length ? <span className="f-quest"> · {c.mechanics.join(", ")}</span> : null}
          </span>
        </div>
      )}
      {s && (
        <div className="ov-map-stats muted">
          {tr("sessão", "session")}: {s.maps} {s.maps === 1 ? tr("mapa", "map") : tr("mapas", "maps")} · {tr("média", "avg")} {fmtMs(s.avgMapMs)}
          {s.mapsPerHour ? ` · ${s.mapsPerHour.toFixed(1)}/h` : ""}
          {maps.today && maps.today.maps !== s.maps ? ` · ${tr("hoje", "today")} ${maps.today.maps}` : ""}
        </div>
      )}
    </div>
  );
}

export function MapsPanelBody({ maps }: { maps: MapStats }) {
  if (!maps.allTime) {
    return <p className="muted">{tr("Nenhum mapa no Client.txt ainda. Abra um mapa e ele aparece aqui sozinho.", "No maps in Client.txt yet. Open a map and it shows up here on its own.")}</p>;
  }
  const c = maps.current;
  const deadliest = [...maps.byMap].filter((m) => m.count >= 3).sort((a, b) => b.deathsPerRun - a.deathsPerRun)[0];
  return (
    <>
      {c && (
        <div className={`map-current${c.inside ? " inside" : ""}`}>
          <div>
            <b>{c.name}</b> <span className="muted">T{c.tier} · {tr("nível", "level")} {c.level}</span>
          </div>
          <div className="big">{fmtMs(c.inMapMs)}</div>
          <div className="muted small">
            {c.inside ? tr("dentro do mapa", "inside the map") : tr("no hideout (o tempo fora não conta)", "in the hideout (time outside does not count)")}
            {c.deaths ? ` · ${c.deaths} ${tr("morte(s)", "death(s)")}` : ""}
          </div>
          {c.mechanics.length > 0 && (
            <div className="chips-row">
              {c.mechanics.map((m) => (
                <span key={m} className="mech-chip">
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="map-aggs">
        <Aggregate title={tr("Sessão atual", "Current session")} a={maps.session} />
        <Aggregate title={tr("Hoje", "Today")} a={maps.today} />
        <Aggregate title={`${tr("Desde", "Since")} ${new Date(maps.allTime.since).toLocaleDateString(locale())}`} a={maps.allTime} />
      </div>

      <h3>{tr("Últimos mapas", "Recent maps")}</h3>
      <table className="farm-items">
        <tbody>
          {maps.recent.map((r) => (
            <tr key={r.start}>
              <td>
                {r.name}
                {r.mechanics.length > 0 && <div className="muted small">{r.mechanics.join(" · ")}</div>}
              </td>
              <td className="muted">T{r.tier}</td>
              <td className="num-cell">{fmtMs(r.inMapMs)}</td>
              <td className={`num-cell${r.deaths ? " warn-text" : " muted"}`}>{r.deaths ? `${r.deaths}✝` : "—"}</td>
              <td className="num-cell muted small">
                {new Date(r.start).toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {maps.mechanics.length > 0 && (
        <>
          <h3>{tr("Mecânicas nos seus mapas", "Mechanics in your maps")}</h3>
          <div className="muted small">{tr("Só as que têm NPC falando (Niko, Einhar, Alva, Jun, Cassia, Envoy...): essências, strongboxes etc. não aparecem no log.", "Only the ones with a talking NPC (Niko, Einhar, Alva, Jun, Cassia, Envoy...): essences, strongboxes etc. do not show in the log.")}</div>
          <table className="farm-items">
            <tbody>
              {maps.mechanics.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td className="num-cell">{m.maps} {m.maps === 1 ? tr("mapa", "map") : tr("mapas", "maps")}</td>
                  <td className="num-cell muted">{m.share > 0 && m.share < 0.005 ? "<1" : Math.round(m.share * 100)}% {tr("dos mapas", "of maps")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>{tr("Mapas que você mais roda", "Your most-run maps")}</h3>
      <table className="farm-items">
        <thead>
          <tr>
            <th>{tr("Mapa", "Map")}</th>
            <th className="num-cell">{tr("Vezes", "Runs")}</th>
            <th className="num-cell">{tr("Tempo médio", "Avg time")}</th>
            <th className="num-cell">{tr("Mortes/mapa", "Deaths/map")}</th>
          </tr>
        </thead>
        <tbody>
          {maps.byMap.map((m) => (
            <tr key={m.name}>
              <td>{m.name}</td>
              <td className="num-cell">{m.count}</td>
              <td className="num-cell">{fmtMs(m.avgMs)}</td>
              <td className={`num-cell${m.deathsPerRun >= 0.5 ? " warn-text" : ""}`}>{m.deathsPerRun.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {deadliest && deadliest.deathsPerRun > 0 && (
        <p className="muted small">
          {tr("Onde você mais morre:", "Where you die the most:")} <b>{deadliest.name}</b> ({deadliest.deathsPerRun.toFixed(2)}{" "}
          {tr("mortes por mapa em", "deaths per map over")} {deadliest.count} runs).
        </p>
      )}
      <p className="muted small">
        {tr(
          'Tudo lido do Client.txt: cada instância de mapa conta uma vez (voltar pelo portal é o mesmo mapa); o tempo no hideout entre portais fica fora do "tempo no mapa".',
          'All read from Client.txt: each map instance counts once (going back through the portal is the same map); hideout time between portals stays out of the "time in map".',
        )}
      </p>
    </>
  );
}
