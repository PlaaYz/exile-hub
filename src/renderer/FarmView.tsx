import { useEffect, useMemo, useState } from "react";
import { farmEv, profitChance, riskOf, type FarmLine, type FarmOverrides, type FarmPrice, type FarmRisk } from "../core/farm";
import { FARM_BOSSES, FARM_POOLS, type FarmBoss } from "../shared/farmData";
import { tr } from "../shared/i18n";
import type { FarmPricesResult } from "../shared/ipc";
import type { AppState } from "../shared/types";
import { fmtChaos } from "./PriceView";

const LS_OVERRIDES = "exile-hub.farmOverrides.v1";
const LS_SELECTED = "exile-hub.farmSelected";
const LS_RANK = "exile-hub.farmRank";

/** Runs in the "chance to profit" batch (same idea as the usual boss calculators). */
const kChanceRuns = 10;

const riskLabel = (r: FarmRisk) =>
  ({
    safe: tr("Seguro", "Safe"),
    low: tr("Risco baixo", "Low risk"),
    medium: tr("Risco médio", "Medium risk"),
    high: tr("Risco alto", "High risk"),
    negative: tr("Prejuízo", "Loss"),
  })[r];
const riskHint = (r: FarmRisk) =>
  ({
    safe: tr("95%+ de chance de lucro em 10 runs", "95%+ chance of profit over 10 runs"),
    low: tr("80–95% de chance de lucro em 10 runs", "80–95% chance of profit over 10 runs"),
    medium: tr("60–80% de chance de lucro em 10 runs", "60–80% chance of profit over 10 runs"),
    high: tr("menos de 60% de chance de lucro em 10 runs", "under 60% chance of profit over 10 runs"),
    negative: tr("perde currency na média", "loses currency on average"),
  })[r];
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
  if (!l.priceManual && livePrice?.source === "trade") notes.push(tr(`preço do trade (${livePrice.listings ?? "?"} anúncios)`, `trade site price (${livePrice.listings ?? "?"} listings)`));
  if (!l.priceManual && livePrice?.variants && livePrice.variants > 1) notes.push(tr(`${livePrice.variants} variantes (mediana)`, `${livePrice.variants} variants (median)`));
  if (l.lowConfidence) notes.push(tr("poucos anúncios", "few listings"));
  if (suspect && l.price === null) notes.push(tr("preço do poe.ninja absurdo, ignorado", "absurd poe.ninja price, ignored"));
  if (l.price === null) notes.push(tr("sem preço: digite", "no price: type one"));
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

/** The drop table notes are written in Portuguese (farmData): their few words, in English. */
const NOTE_EN: [RegExp, string][] = [
  [/com 100% de quantidade de itens no mapa/, "with 100% item quantity on the map"],
  [/estimativa sem amostra grande/, "estimate without a large sample"],
  [/taxas publicadas/, "published rates"],
  [/\(pós-rebalance\)/, "(after the rebalance)"],
  [/\(conteúdo novo\)/, "(new content)"],
  [/comunidade/, "community"],
  [/aproximado/, "approximate"],
  [/(\d)\.(\d{3})/g, "$1,$2"],
];
function sourceNote(note: string): string {
  return tr(note, NOTE_EN.reduce((t, [re, en]) => t.replace(re, en), note));
}

/** 2.5 -> "2:30" */
function fmtMin(min: number): string {
  const s = Math.round(min * 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtAgo(ts: number | null): string {
  if (!ts) return "";
  const d = Math.round((Date.now() - ts) / 86_400_000);
  return d <= 0 ? tr("hoje", "today") : d === 1 ? tr("ontem", "yesterday") : tr(`há ${d} dias`, `${d} days ago`);
}

type Measured = { runs: number; minutes: number | null; deaths: number | null; lastRunAt: number | null };

export function FarmPanelBody({
  runs: bossRuns,
  maps,
  pricesVersion,
}: {
  runs: AppState["farmRuns"];
  maps: AppState["maps"]["byMap"];
  pricesVersion: number;
}) {
  // what Client.txt measured: boss arenas, and T17 maps from the map tracker (average time in the map)
  const runs = useMemo(() => {
    const out: Record<string, Measured> = {};
    for (const [id, r] of Object.entries(bossRuns)) out[id] = { runs: r.runs, minutes: r.minutes, deaths: r.deaths, lastRunAt: r.lastRunAt };
    for (const b of FARM_BOSSES) {
      const m = b.mapName ? maps.find((x) => x.name === b.mapName) : undefined;
      if (m && m.count > 0) out[b.id] = { runs: m.count, minutes: Math.round((m.avgMs / 60000) * 10) / 10, deaths: null, lastRunAt: null };
    }
    return out;
  }, [bossRuns, maps]);
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
        // minutes per run: what the player typed, else what Client.txt measured; nothing else is guessed
        const measured = runs[b.id]?.minutes ?? null;
        const minutes = ov.minutesPerRun ?? measured ?? null;
        const minutesFrom: "você" | "medido" | null = ov.minutesPerRun != null ? "você" : measured != null ? "medido" : null;
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
        .sort((a, b) => {
          if (rank === "kill") return b.r.profit - a.r.profit;
          // bosses without a time yet go after the timed ones, by profit per kill
          const ah = a.r.profitPerHour;
          const bh = b.r.profitPerHour;
          if (ah === null || bh === null) return ah === null && bh === null ? b.r.profit - a.r.profit : ah === null ? 1 : -1;
          return bh - ah;
        }),
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

  if (!data) return <p className="muted">{loading ? tr("Carregando preços do poe.ninja…", "Loading poe.ninja prices…") : "—"}</p>;

  const ov = overrides[cur.boss.id] ?? {};
  return (
    <>
      <div className="row">
        <span className="muted small">
          {tr("liga", "league")} {data.league ?? "?"}
          {cpd ? ` · 1 div = ${Math.round(cpd)} c` : ""} · {tr("preços do poe.ninja e do trade", "poe.ninja and trade site prices")}
          {data.tradePending > 0 ? tr(` · buscando ${data.tradePending} preço(s) no trade…`, ` · looking up ${data.tradePending} price(s) on the trade site…`) : ""}
        </span>
        <button disabled={loading} onClick={() => void refresh()}>
          {loading ? tr("Atualizando…", "Updating…") : tr("Atualizar preços", "Update prices")}
        </button>
      </div>
      {data.error && <div className="warn">{tr("Erro ao buscar preços:", "Could not fetch prices:")} {data.error}</div>}

      <div className="row farm-controls">
        <span className="muted small">{tr("Ordenar por", "Sort by")}</span>
        <button className={`chip${rank === "hour" ? " on" : ""}`} onClick={() => setRank("hour")}>
          {tr("Lucro/hora", "Profit/hour")}
        </button>
        <button className={`chip${rank === "kill" ? " on" : ""}`} onClick={() => setRank("kill")}>
          {tr("Lucro/kill", "Profit/kill")}
        </button>
        <span className="muted small">·</span>
        <button className={`chip${riskFilter === "all" ? " on" : ""}`} onClick={() => setRiskFilter("all")}>
          {tr("Todos", "All")} {computed.length}
        </button>
        {RISKS.map((k) => {
          const n = computed.filter((x) => x.risk === k).length;
          return n ? (
            <button key={k} className={`chip risk-chip ${k}${riskFilter === k ? " on" : ""}`} title={riskHint(k)} onClick={() => setRiskFilter(k)}>
              {riskLabel(k)} {n}
            </button>
          ) : null;
        })}
      </div>

      <table className="farm-rank">
        <thead>
          <tr>
            <th>Boss</th>
            <th className="num-cell" title={tr("chance de terminar 10 runs no lucro", "chance that 10 runs end in profit")}>
              Chance (10 runs)
            </th>
            <th className="num-cell">{tr("Entrada", "Entry")}</th>
            <th className="num-cell">{tr("Lucro/kill", "Profit/kill")}</th>
            <th className="num-cell">{tr("Lucro/h", "Profit/h")}</th>
            <th className="num-cell" title={tr("tempo por run usado no lucro/hora", "time per run used for profit/hour")}>
              {tr("Tempo/run", "Time/run")}
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
                {r.missing.length > 0 && <span className="muted small"> · {r.missing.length} {tr("sem preço", "unpriced")}</span>}
              </td>
              <td className="num-cell">
                <span className={`risk-badge ${risk}`} title={riskHint(risk)}>
                  {chance === null ? "—" : `${Math.round(chance * 100)}%`}
                </span>
              </td>
              <td className="num-cell">{money(r.entryCost, cpd)}</td>
              <td className="num-cell profit">{money(r.profit, cpd)}</td>
              <td className="num-cell">{r.profitPerHour === null ? "—" : money(r.profitPerHour, cpd)}</td>
              <td className="num-cell">
                {minutes ? fmtMin(minutes) : "—"}{" "}
                {minutesFrom === "medido" ? (
                  <span className="time-src log" title={tr("medido nas suas runs do Client.txt", "measured from your runs in Client.txt")}>
                    {tr("seu log", "your log")} · {runs[boss.id].runs} run{runs[boss.id].runs > 1 ? "s" : ""}
                  </span>
                ) : minutesFrom === "você" ? (
                  <span className="time-src typed">{tr("digitado", "typed")}</span>
                ) : (
                  <span className="time-src" title={tr("ainda sem run deste boss no seu log: clique e digite um tempo, se quiser", "no run of this boss in your log yet: click it and type a time if you want")}>
                    {tr("sem run", "no runs")}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        {tr(
          "Chance = quantas vezes 10 runs seguidas terminam no lucro (simulação com as taxas e os preços da tabela). Tempo/run: o app mede sozinho as suas runs no Client.txt (seu log; nos T17, o tempo médio dentro do mapa). Boss que você ainda não fez fica sem lucro/hora até a primeira run; se quiser, clique nele e digite um tempo.",
          "Chance = how often 10 runs in a row end in profit (a simulation with the table's rates and prices). Time/run: the app measures your runs in Client.txt on its own (your log; for T17 maps, the average time inside the map). A boss you have not run yet has no profit/hour until the first run; click it and type a time if you want.",
        )}
      </p>

      <h3>{cur.boss.name}</h3>
      <div className="row">
        <span className="muted">{tr("Minutos por run", "Minutes per run")}</span>
        <NumInput
          value={ov.minutesPerRun ?? undefined}
          placeholder={runs[cur.boss.id]?.minutes != null ? String(runs[cur.boss.id].minutes) : "—"}
          edited={ov.minutesPerRun != null}
          onChange={(v) => patch(cur.boss, (o) => ({ ...o, minutesPerRun: v ?? null }))}
        />
        <span className="muted small">
          {runs[cur.boss.id]
            ? `${tr("medido no seu Client.txt", "measured in your Client.txt")}: ${runs[cur.boss.id].runs} ${cur.boss.mapName ? tr("mapa(s)", "map(s)") : "run(s)"}, ${runs[cur.boss.id].minutes} min/run${runs[cur.boss.id].deaths !== null ? `, ${runs[cur.boss.id].deaths} ${tr("morte(s)", "death(s)")}` : ""}${runs[cur.boss.id].lastRunAt ? `, ${tr("última", "last")} ${fmtAgo(runs[cur.boss.id].lastRunAt)}` : ""}`
            : tr("nenhuma run deste boss no seu Client.txt ainda: sem lucro/hora até a primeira (ou digite um tempo)", "no run of this boss in your Client.txt yet: no profit/hour until the first one (or type a time)")}
        </span>
      </div>
      <table className="farm-items">
        <thead>
          <tr>
            <th>{tr("Entrada", "Entry")}</th>
            <th>{tr("Qtd", "Qty")}</th>
            <th>{tr("Preço (c)", "Price (c)")}</th>
            <th className="num-cell">{tr("Custo", "Cost")}</th>
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
            <th>{tr("Por 100 kills", "Per 100 kills")}</th>
            <th>{tr("Preço (c)", "Price (c)")}</th>
            <th className="num-cell">{tr("Média/run", "Avg/run")}</th>
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
          {tr("Lucro esperado por run:", "Expected profit per run:")} <span className={cur.r.profit < 0 ? "warn-text" : "good"}>{money(cur.r.profit, cpd)}</span>
        </b>
        <span className={`risk-badge ${cur.risk}`}>
          {riskLabel(cur.risk)}
          {cur.chance !== null ? ` · ${Math.round(cur.chance * 100)}% ${tr("de lucro em 10 runs", "profit over 10 runs")}` : ""}
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
          {tr("Restaurar padrão", "Reset to default")}
        </button>
      </div>
      <p className="muted small">
        {tr("Chances de drop:", "Drop rates:")} <b>{tr("estimativa da comunidade", "community estimate")}</b>
        {tr(", não dado oficial (a GGG não publica). Fonte:", ", not official data (GGG does not publish them). Source:")}{" "}
        {cur.boss.source.url.replace(/^https:\/\//, "")} ({sourceNote(cur.boss.source.note)}).{" "}
        {tr(
          "Campos em amarelo foram editados por você. Itens sem preço contam como 0. É a média de longo prazo: em poucas runs o resultado varia muito.",
          "Yellow fields were edited by you. Items without a price count as 0. This is the long-run average: over a few runs the result varies a lot.",
        )}
      </p>
    </>
  );
}
