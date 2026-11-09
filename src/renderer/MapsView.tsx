import type { MapAggregate, MapStats } from "../core/maps";
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
          <div className="muted small">mapas</div>
          <div className="map-agg-row">
            <span>{fmtMs(a.avgMapMs)}</span>
            <span className="muted small">média no mapa</span>
          </div>
          <div className="map-agg-row">
            <span>{perHour(a)}</span>
            <span className="muted small">mapas/hora</span>
          </div>
          <div className="map-agg-row">
            <span>{fmtMs(a.ms - a.inMapMs)}</span>
            <span className="muted small">fora do mapa</span>
          </div>
          <div className="map-agg-row">
            <span className={a.deaths ? "warn-text" : ""}>{a.deaths}</span>
            <span className="muted small">mortes</span>
          </div>
        </>
      ) : (
        <div className="muted small">nenhum mapa</div>
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
          sessão: {s.maps} {s.maps === 1 ? "mapa" : "mapas"} · média {fmtMs(s.avgMapMs)}
          {s.mapsPerHour ? ` · ${s.mapsPerHour.toFixed(1)}/h` : ""}
          {maps.today && maps.today.maps !== s.maps ? ` · hoje ${maps.today.maps}` : ""}
        </div>
      )}
    </div>
  );
}

export function MapsPanelBody({ maps }: { maps: MapStats }) {
  if (!maps.allTime) {
    return <p className="muted">Nenhum mapa no Client.txt ainda. Abra um mapa e ele aparece aqui sozinho.</p>;
  }
  const c = maps.current;
  const deadliest = [...maps.byMap].filter((m) => m.count >= 3).sort((a, b) => b.deathsPerRun - a.deathsPerRun)[0];
  return (
    <>
      {c && (
        <div className={`map-current${c.inside ? " inside" : ""}`}>
          <div>
            <b>{c.name}</b> <span className="muted">T{c.tier} · nível {c.level}</span>
          </div>
          <div className="big">{fmtMs(c.inMapMs)}</div>
          <div className="muted small">
            {c.inside ? "dentro do mapa" : "no hideout (o tempo fora não conta)"}
            {c.deaths ? ` · ${c.deaths} morte(s)` : ""}
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
        <Aggregate title="Sessão atual" a={maps.session} />
        <Aggregate title="Hoje" a={maps.today} />
        <Aggregate title={`Desde ${new Date(maps.allTime.since).toLocaleDateString("pt-BR")}`} a={maps.allTime} />
      </div>

      <h3>Últimos mapas</h3>
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
                {new Date(r.start).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {maps.mechanics.length > 0 && (
        <>
          <h3>Mecânicas nos seus mapas</h3>
          <div className="muted small">Só as que têm NPC falando (Niko, Einhar, Alva, Jun, Cassia, Envoy...): essências, strongboxes etc. não aparecem no log.</div>
          <table className="farm-items">
            <tbody>
              {maps.mechanics.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td className="num-cell">{m.maps} mapas</td>
                  <td className="num-cell muted">{Math.round(m.share * 100)}% dos mapas</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>Mapas que você mais roda</h3>
      <table className="farm-items">
        <thead>
          <tr>
            <th>Mapa</th>
            <th>Vezes</th>
            <th>Tempo médio</th>
            <th>Mortes/mapa</th>
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
          Onde você mais morre: <b>{deadliest.name}</b> ({deadliest.deathsPerRun.toFixed(2)} mortes por mapa em{" "}
          {deadliest.count} runs).
        </p>
      )}
      <p className="muted small">
        Tudo lido do Client.txt: cada instância de mapa conta uma vez (voltar pelo portal é o mesmo mapa); o tempo no
        hideout entre portais fica fora do "tempo no mapa".
      </p>
    </>
  );
}
