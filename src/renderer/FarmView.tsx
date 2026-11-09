import { useEffect, useMemo, useState } from "react";
import { farmEv, profitChance, riskOf, type FarmLine, type FarmOverrides, type FarmPrice, type FarmRisk } from "../core/farm";
import { FARM_BOSSES, FARM_DEFAULT_MINUTES, FARM_POOLS, type FarmBoss } from "../shared/farmData";
import type { FarmPricesResult } from "../shared/ipc";
import type { AppState } from "../shared/types";
import { fmtChaos } from "./PriceView";

const LS_OVERRIDES = "exile-hub.farmOverrides.v1";
const LS_SELECTED = "exile-hub.farmSelected";
const LS_RANK = "exile-hub.farmRank";

/** Runs in the "chance to profit" batch (same idea as the usual boss calculators). */
const kChanceRuns = 10;

const RISK_LABEL: Record<FarmRisk, string> = {
  safe: "Seguro",
  low: "Risco baixo",
  medium: "Risco médio",
  high: "Risco alto",
  negative: "Prejuízo",
};
const RISK_HINT: Record<FarmRisk, string> = {
  safe: "95%+ de chance de lucro em 10 runs",
  low: "80–95% de chance de lucro em 10 runs",
  medium: "60–80% de chance de lucro em 10 runs",
  high: "menos de 60% de chance de lucro em 10 runs",
  negative: "perde currency na média",
};
const RISKS: FarmRisk[] = ["safe", "low", "medium", "high", "negative"];

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

type LivePrice = FarmPricesResult["prices"][string];

function ItemRow({
  l,
  isDrop,
  livePrice,
  suspect,
  cpd,
  onAmount,
  onPrice,
}: {
  l: FarmLine;
  isDrop: boolean;
  livePrice: LivePrice | undefined;
  suspect: boolean;
  cpd: number | null;
  onAmount: (v: number | undefined) => void;
  onPrice: (v: number | undefined) => void;
}) {
  const notes: string[] = [];
  if (!l.priceManual && livePrice?.source === "trade") notes.push(`preço do trade (${livePrice.listings ?? "?"} anúncios)`);
  if (!l.priceManual && livePrice?.variants && livePrice.variants > 1) notes.push(`${livePrice.variants} variantes (mediana)`);
  if (l.lowConfidence) notes.push("poucos anúncios");
  if (suspect && l.price === null) notes.push("preço do poe.ninja absurdo, ignorado");
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

/** 2.5 -> "2:30" */
function fmtMin(min: number): string {
  const s = Math.round(min * 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtAgo(ts: number | null): string {
  if (!ts) return "";
  const d = Math.round((Date.now() - ts) / 86_400_000);
  return d <= 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`;
}

export function FarmPanelBody({ runs, pricesVersion }: { runs: AppState["farmRuns"]; pricesVersion: number }) {
  const [data, setData] = useState<FarmPricesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [overrides, setOverrides] = useState<AllOverrides>(() => load(LS_OVERRIDES, {}));
  const [selected, setSelected] = useState<string>(() => load(LS_SELECTED, FARM_BOSSES[0].id));
  const [rank, setRank] = useState<"hour" | "kill">(() => load(LS_RANK, "hour"));
  const [riskFilter, setRiskFilter] = useState<FarmRisk | "all">("all");

  const refresh = async () => {
    setLoading(true);
    try {
      setData(await window.hub.farmPrices());
    } finally {
      setLoading(false);
    }
  };
  // again when the trade site's prices for what poe.ninja lacks arrive
  useEffect(() => {
    void refresh();
  }, [pricesVersion]);
  useEffect(() => save(LS_OVERRIDES, overrides), [overrides]);
  useEffect(() => save(LS_SELECTED, selected), [selected]);
  useEffect(() => save(LS_RANK, rank), [rank]);

  const prices = useMemo(() => new Map<string, FarmPrice & LivePrice>(Object.entries(data?.prices ?? {})), [data]);
  const suspect = useMemo(() => new Set(data?.suspect ?? []), [data]);
  const cpd = data?.chaosPerDivine ?? null;
  const computed = useMemo(
    () =>
      FARM_BOSSES.map((b) => {
        const ov = overrides[b.id] ?? {};
        // minutes per run: what the user typed, else what Client.txt measured, else our estimate
        const measured = runs[b.id]?.minutes ?? null;
        const minutes = ov.minutesPerRun ?? measured ?? FARM_DEFAULT_MINUTES[b.id] ?? null;
        const minutesFrom: "você" | "medido" | "estimado" = ov.minutesPerRun != null ? "você" : measured != null ? "medido" : "estimado";
        const r = farmEv(b, prices, { ...ov, minutesPerRun: minutes });
        const chance = profitChance(r, FARM_POOLS[b.id], kChanceRuns, 2000);
        return { boss: b, r, chance, risk: riskOf(r.profit, chance), minutes, minutesFrom };
      }),
    [prices, overrides, runs],
  );
  const results = useMemo(
    () =>
      [...computed]
        .filter((x) => riskFilter === "all" || x.risk === riskFilter)
        .sort((a, b) => (rank === "hour" ? (b.r.profitPerHour ?? -Infinity) - (a.r.profitPerHour ?? -Infinity) : b.r.profit - a.r.profit)),
    [computed, rank, riskFilter],
  );
  const cur = computed.find((x) => x.boss.id === selected) ?? results[0] ?? computed[0];

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
          {cpd ? ` · 1 div = ${Math.round(cpd)} c` : ""} · preços do poe.ninja e do trade
          {data.tradePending > 0 ? ` · buscando ${data.tradePending} preço(s) no trade…` : ""}
        </span>
        <button disabled={loading} onClick={() => void refresh()}>
          {loading ? "Atualizando…" : "Atualizar preços"}
        </button>
      </div>
      {data.error && <div className="warn">Erro ao buscar preços: {data.error}</div>}

      <div className="row farm-controls">
        <span className="muted small">Ordenar por</span>
        <button className={`chip${rank === "hour" ? " on" : ""}`} onClick={() => setRank("hour")}>
          Lucro/hora
        </button>
        <button className={`chip${rank === "kill" ? " on" : ""}`} onClick={() => setRank("kill")}>
          Lucro/kill
        </button>
        <span className="muted small">·</span>
        <button className={`chip${riskFilter === "all" ? " on" : ""}`} onClick={() => setRiskFilter("all")}>
          Todos {computed.length}
        </button>
        {RISKS.map((k) => {
          const n = computed.filter((x) => x.risk === k).length;
          return n ? (
            <button key={k} className={`chip risk-chip ${k}${riskFilter === k ? " on" : ""}`} title={RISK_HINT[k]} onClick={() => setRiskFilter(k)}>
              {RISK_LABEL[k]} {n}
            </button>
          ) : null;
        })}
      </div>

      <table className="farm-rank">
        <thead>
          <tr>
            <th>Boss</th>
            <th className="num-cell" title="chance de terminar 10 runs no lucro">
              Chance (10 runs)
            </th>
            <th className="num-cell">Entrada</th>
            <th className="num-cell">Lucro/kill</th>
            <th className="num-cell">Lucro/h</th>
            <th className="num-cell" title="tempo por run usado no lucro/hora">
              Tempo/run
            </th>
          </tr>
        </thead>
        <tbody>
          {results.map(({ boss, r, chance, risk, minutes, minutesFrom }) => (
            <tr
              key={boss.id}
              className={`${boss.id === cur.boss.id ? "sel" : ""}${r.profit < 0 ? " neg" : ""}`}
              onClick={() => setSelected(boss.id)}
            >
              <td>
                {boss.name}
                {r.missing.length > 0 && <span className="muted small"> · {r.missing.length} sem preço</span>}
              </td>
              <td className="num-cell">
                <span className={`risk-badge ${risk}`} title={RISK_HINT[risk]}>
                  {chance === null ? "—" : `${Math.round(chance * 100)}%`}
                </span>
              </td>
              <td className="num-cell">{money(r.entryCost, cpd)}</td>
              <td className="num-cell profit">{money(r.profit, cpd)}</td>
              <td className="num-cell">{r.profitPerHour === null ? "—" : money(r.profitPerHour, cpd)}</td>
              <td className="num-cell">
                {minutes ? fmtMin(minutes) : "—"}{" "}
                {minutesFrom === "medido" ? (
                  <span className="time-src log" title="medido nas suas runs do Client.txt">
                    seu log · {runs[boss.id].runs} run{runs[boss.id].runs > 1 ? "s" : ""}
                  </span>
                ) : minutesFrom === "você" ? (
                  <span className="time-src typed">digitado</span>
                ) : (
                  <span className="time-src" title="ainda sem run deste boss no seu log">
                    padrão
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Chance = quantas vezes 10 runs seguidas terminam no lucro (simulação com as taxas e os preços da tabela). Tempo/run: o app
        mede sozinho as suas runs no Client.txt (<b>seu log</b>) e usa esse tempo assim que você faz o boss; antes disso usa o
        tempo <b>padrão</b>. Para usar outro, clique no boss e digite.
      </p>

      <h3>{cur.boss.name}</h3>
      <div className="row">
        <span className="muted">Minutos por run</span>
        <NumInput
          value={ov.minutesPerRun ?? undefined}
          placeholder={runs[cur.boss.id]?.minutes != null ? String(runs[cur.boss.id].minutes) : String(Math.round((FARM_DEFAULT_MINUTES[cur.boss.id] ?? 4) * 100) / 100)}
          edited={ov.minutesPerRun != null}
          onChange={(v) => patch(cur.boss, (o) => ({ ...o, minutesPerRun: v ?? null }))}
        />
        <span className="muted small">
          {runs[cur.boss.id]
            ? `medido no seu Client.txt: ${runs[cur.boss.id].runs} run(s), ${runs[cur.boss.id].minutes} min/run, ${runs[cur.boss.id].deaths} morte(s), última ${fmtAgo(runs[cur.boss.id].lastRunAt)}`
            : `nenhuma run deste boss no seu Client.txt ainda: usando ${Math.round((FARM_DEFAULT_MINUTES[cur.boss.id] ?? 0) * 100) / 100} min (seu tempo padrão), digite o seu tempo`}
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
              suspect={suspect.has(l.name)}
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
              suspect={suspect.has(l.name)}
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
        <span className={`risk-badge ${cur.risk}`}>
          {RISK_LABEL[cur.risk]}
          {cur.chance !== null ? ` · ${Math.round(cur.chance * 100)}% de lucro em 10 runs` : ""}
        </span>
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
