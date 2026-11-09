import { useEffect, useMemo, useState } from "react";
import { farmEv, type FarmLine, type FarmOverrides, type FarmPrice } from "../core/farm";
import { FARM_BOSSES, type FarmBoss } from "../shared/farmData";
import type { FarmPricesResult } from "../shared/ipc";
import type { AppState } from "../shared/types";
import { fmtChaos } from "./PriceView";

const LS_OVERRIDES = "exile-hub.farmOverrides.v1";
const LS_SELECTED = "exile-hub.farmSelected";

type AllOverrides = Record<string, FarmOverrides>;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

/** Number input that keeps what is being typed and reports a number (or undefined when cleared). */
function NumInput({
  value,
  placeholder,
  onChange,
  edited,
}: {
  value: number | undefined;
  placeholder?: string;
  onChange: (v: number | undefined) => void;
  edited?: boolean;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  return (
    <input
      className={`num${edited ? " edited" : ""}`}
      type="number"
      step="any"
      min="0"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.value === "" ? undefined : Number(e.target.value);
        if (n === undefined || (Number.isFinite(n) && n >= 0)) onChange(n);
      }}
    />
  );
}

function money(c: number | null, cpd: number | null): string {
  if (c === null) return "—";
  const sign = c < 0 ? "−" : "";
  return sign + fmtChaos(Math.abs(c), cpd);
}

function ItemRow({
  l,
  isDrop,
  livePrice,
  cpd,
  onAmount,
  onPrice,
}: {
  l: FarmLine;
  isDrop: boolean;
  livePrice: FarmPrice | undefined;
  cpd: number | null;
  onAmount: (v: number | undefined) => void;
  onPrice: (v: number | undefined) => void;
}) {
  const notes: string[] = [];
  if (!l.priceManual && livePrice?.variants && livePrice.variants > 1) notes.push(`${livePrice.variants} variantes (mediana)`);
  if (l.lowConfidence) notes.push("poucos anúncios");
  if (l.price === null) notes.push("sem preço: digite");
  return (
    <tr>
      <td>
        {l.name}
        {notes.length > 0 && <div className="muted small">{notes.join(" · ")}</div>}
      </td>
      <td>
        {isDrop ? (
          <NumInput value={l.amountEdited ? l.amount : undefined} placeholder={String(l.amount)} onChange={onAmount} edited={l.amountEdited} />
        ) : (
          <span>{l.amount}×</span>
        )}
      </td>
      <td>
        <NumInput
          value={l.priceManual ? (l.price ?? undefined) : undefined}
          placeholder={livePrice ? String(Math.round(livePrice.chaos * 10) / 10) : "?"}
          onChange={onPrice}
          edited={l.priceManual}
        />
      </td>
      <td className="num-cell">{money(l.value, cpd)}</td>
    </tr>
  );
}

function fmtAgo(ts: number | null): string {
  if (!ts) return "";
  const d = Math.round((Date.now() - ts) / 86_400_000);
  return d <= 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`;
}

export function FarmPanelBody({ runs }: { runs: AppState["farmRuns"] }) {
  const [data, setData] = useState<FarmPricesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [overrides, setOverrides] = useState<AllOverrides>(() => load(LS_OVERRIDES, {}));
  const [selected, setSelected] = useState<string>(() => load(LS_SELECTED, FARM_BOSSES[0].id));

  const refresh = async () => {
    setLoading(true);
    try {
      setData(await window.hub.farmPrices());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => save(LS_OVERRIDES, overrides), [overrides]);
  useEffect(() => save(LS_SELECTED, selected), [selected]);

  const prices = useMemo(() => new Map(Object.entries(data?.prices ?? {})), [data]);
  const cpd = data?.chaosPerDivine ?? null;
  const results = useMemo(
    () =>
      FARM_BOSSES.map((b) => {
        const ov = overrides[b.id] ?? {};
        // minutes per run: what the user typed, else what Client.txt measured
        const measured = runs[b.id]?.minutes ?? null;
        return { boss: b, r: farmEv(b, prices, { ...ov, minutesPerRun: ov.minutesPerRun ?? measured }) };
      }).sort((a, b) => b.r.profit - a.r.profit),
    [prices, overrides, runs],
  );
  const cur = results.find((x) => x.boss.id === selected) ?? results[0];

  const patch = (boss: FarmBoss, f: (o: FarmOverrides) => FarmOverrides) =>
    setOverrides((all) => ({ ...all, [boss.id]: f(all[boss.id] ?? {}) }));
  const setKey = (rec: Record<string, number> | undefined, k: string, v: number | undefined) => {
    const out = { ...(rec ?? {}) };
    if (v === undefined) delete out[k];
    else out[k] = v;
    return out;
  };

  if (!data) return <p className="muted">{loading ? "Carregando preços do poe.ninja…" : "—"}</p>;

  const ov = overrides[cur.boss.id] ?? {};
  return (
    <>
      <div className="row">
        <span className="muted small">
          liga {data.league ?? "?"}
          {cpd ? ` · 1 div = ${Math.round(cpd)} c` : ""} · preços do poe.ninja
        </span>
        <button disabled={loading} onClick={() => void refresh()}>
          {loading ? "Atualizando…" : "Atualizar preços"}
        </button>
      </div>
      {data.error && <div className="warn">Erro ao buscar preços: {data.error}</div>}

      <table className="farm-rank">
        <thead>
          <tr>
            <th>Boss</th>
            <th className="num-cell">Entrada</th>
            <th className="num-cell">Drops (média)</th>
            <th className="num-cell">Lucro/run</th>
            <th className="num-cell">Lucro/h</th>
            <th className="num-cell">Suas runs</th>
          </tr>
        </thead>
        <tbody>
          {results.map(({ boss, r }) => (
            <tr
              key={boss.id}
              className={`${boss.id === cur.boss.id ? "sel" : ""}${r.profit < 0 ? " neg" : ""}`}
              onClick={() => setSelected(boss.id)}
            >
              <td>
                {boss.name}
                {r.missing.length > 0 && <span className="muted small"> · {r.missing.length} sem preço</span>}
              </td>
              <td className="num-cell">{money(r.entryCost, cpd)}</td>
              <td className="num-cell">{money(r.dropsValue, cpd)}</td>
              <td className="num-cell profit">{money(r.profit, cpd)}</td>
              <td className="num-cell">{r.profitPerHour === null ? "—" : money(r.profitPerHour, cpd)}</td>
              <td className="num-cell muted">
                {runs[boss.id] ? `${runs[boss.id].runs} · ${runs[boss.id].minutes ?? "?"} min` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{cur.boss.name}</h3>
      <div className="row">
        <span className="muted">Minutos por run</span>
        <NumInput
          value={ov.minutesPerRun ?? undefined}
          placeholder={runs[cur.boss.id]?.minutes != null ? String(runs[cur.boss.id].minutes) : "ex.: 4"}
          edited={ov.minutesPerRun != null}
          onChange={(v) => patch(cur.boss, (o) => ({ ...o, minutesPerRun: v ?? null }))}
        />
        <span className="muted small">
          {runs[cur.boss.id]
            ? `medido no seu Client.txt: ${runs[cur.boss.id].runs} run(s), ${runs[cur.boss.id].minutes} min/run, ${runs[cur.boss.id].deaths} morte(s), última ${fmtAgo(runs[cur.boss.id].lastRunAt)}`
            : "nenhuma run deste boss no seu Client.txt ainda: digite uma estimativa"}
        </span>
      </div>
      <table className="farm-items">
        <thead>
          <tr>
            <th>Entrada</th>
            <th>Qtd</th>
            <th>Preço (c)</th>
            <th className="num-cell">Custo</th>
          </tr>
        </thead>
        <tbody>
          {cur.r.entry.map((l) => (
            <ItemRow
              key={l.name}
              l={l}
              isDrop={false}
              livePrice={prices.get(l.name)}
              cpd={cpd}
              onAmount={() => undefined}
              onPrice={(v) => patch(cur.boss, (o) => ({ ...o, prices: setKey(o.prices, l.name, v) }))}
            />
          ))}
        </tbody>
        <thead>
          <tr>
            <th>Drop</th>
            <th>Por 100 kills</th>
            <th>Preço (c)</th>
            <th className="num-cell">Média/run</th>
          </tr>
        </thead>
        <tbody>
          {[...cur.r.drops]
            .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
            .map((l) => (
              <ItemRow
                key={l.name}
                l={l}
                isDrop
                livePrice={prices.get(l.name)}
                cpd={cpd}
                onAmount={(v) => patch(cur.boss, (o) => ({ ...o, amounts: setKey(o.amounts, l.name, v) }))}
                onPrice={(v) => patch(cur.boss, (o) => ({ ...o, prices: setKey(o.prices, l.name, v) }))}
              />
            ))}
        </tbody>
      </table>
      <div className="row">
        <b>
          Lucro esperado por run: <span className={cur.r.profit < 0 ? "warn-text" : "good"}>{money(cur.r.profit, cpd)}</span>
        </b>
        <button
          className="danger"
          disabled={!overrides[cur.boss.id]}
          onClick={() =>
            setOverrides((all) => {
              const { [cur.boss.id]: _drop, ...rest } = all;
              return rest;
            })
          }
        >
          Restaurar padrão
        </button>
      </div>
      <p className="muted small">
        Chances de drop: <b>estimativa da comunidade</b>, não dado oficial (a GGG não publica). Fonte:{" "}
        {cur.boss.source.url.replace(/^https:\/\//, "")} ({cur.boss.source.note}). Campos em amarelo foram editados por
        você. Itens sem preço contam como 0. É a média de longo prazo: em poucas runs o resultado varia muito.
      </p>
    </>
  );
}
