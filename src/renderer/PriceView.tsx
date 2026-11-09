import { useEffect, useState } from "react";
import type { PriceFilters, PriceModFilter, PriceRange, PriceView } from "../shared/types";

const CURRENCY_SHORT: Record<string, string> = { chaos: "c", divine: "div", exalted: "ex" };

export function fmtChaos(chaos: number, chaosPerDivine: number | null): string {
  if (chaosPerDivine && chaos >= chaosPerDivine) {
    const d = chaos / chaosPerDivine;
    return `${d >= 10 ? Math.round(d) : d.toFixed(1)} div`;
  }
  return `${chaos >= 10 ? Math.round(chaos) : chaos.toFixed(1)} c`;
}

function fmtAmount(amount: number, currency: string): string {
  return `${amount} ${CURRENCY_SHORT[currency] ?? currency}`;
}

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}

export function itemTitle(p: PriceView): string {
  const it = p.item;
  const parts = [it.name && it.name !== it.baseType ? `${it.name} — ${it.baseType}` : it.baseType || it.name];
  if (it.gemLevel !== null) parts.push(`nível ${it.gemLevel}${it.quality ? ` / ${it.quality}%` : ""}`);
  if (it.links >= 5) parts.push(`${it.links}L`);
  if (it.stackSize && it.stackSize > 1) parts.push(`x${it.stackSize}`);
  if (it.corrupted) parts.push("corrompido");
  return parts.join(" · ");
}

/** Compact lines shared by the overlay card and the dashboard panel. */
export function PriceSummary({ p }: { p: PriceView }) {
  const cpd = p.chaosPerDivine;
  const stack = p.item.stackSize && p.item.stackSize > 1 ? p.item.stackSize : null;
  // poe.ninja has no prices for rares / magic items: don't show an empty line for them
  const showNinja = !(p.ninjaStatus === "n/a" && /^(Rare|Magic)$/.test(p.item.rarity));
  return (
    <div className="price-summary">
      {showNinja && <div className="price-line">
        <span className="price-src">poe.ninja</span>
        {p.ninjaStatus === "loading" && <span className="muted">consultando…</span>}
        {p.ninjaStatus === "n/a" && <span className="muted">sem referência</span>}
        {p.ninjaStatus === "error" && <span className="warn-text">erro: {p.ninjaError}</span>}
        {p.ninjaStatus === "done" && p.ninja && (
          <span>
            <b>{fmtChaos(p.ninja.chaos, cpd)}</b>
            {stack ? <span className="muted"> · pilha: {fmtChaos(p.ninja.chaos * stack, cpd)}</span> : null}
            {p.ninja.lowConfidence && <span className="warn-text"> · poucos anúncios, desconfie</span>}
          </span>
        )}
      </div>}
      {p.tradeStatus !== "n/a" && (
        <div className="price-line">
          <span className="price-src">trade</span>
          {p.tradeStatus === "loading" && <span className="muted">buscando…</span>}
          {p.tradeStatus === "error" && <span className="warn-text">{p.tradeError}</span>}
          {p.tradeStatus === "done" && p.trade && (
            p.trade.total === 0 ? (
              <span className="muted">nenhum anúncio parecido</span>
            ) : (
              <span>
                {p.trade.medianChaos !== null ? <b>~{fmtChaos(p.trade.medianChaos, cpd)}</b> : null}
                <span className="muted">
                  {" "}
                  · mais barato {fmtAmount(p.trade.listings[0].amount, p.trade.listings[0].currency)} · {p.trade.total}{" "}
                  anúncios
                </span>
              </span>
            )
          )}
        </div>
      )}
    </div>
  );
}

const numIn = (v: string): number | null => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

const KIND_LABEL: Record<string, string> = {
  pseudo: "total",
  implicit: "implícito",
  crafted: "craftado",
  fractured: "fraturado",
  enchant: "encantamento",
};

/** One number filter row: on/off, label, current value, min, max. */
function RangeRow({
  label,
  r,
  current,
  onChange,
}: {
  label: string;
  r: PriceRange;
  current?: string;
  onChange: (r: PriceRange) => void;
}) {
  return (
    <label className="mod">
      <input type="checkbox" checked={r.enabled} onChange={(e) => onChange({ ...r, enabled: e.target.checked })} />
      <span className="mod-text">
        {label}
        {current ? <span className="muted"> ({current})</span> : null}
      </span>
      <input className="mod-min" type="number" placeholder="mín" value={r.min ?? ""} onChange={(e) => onChange({ ...r, enabled: true, min: numIn(e.target.value) })} />
      <input className="mod-min" type="number" placeholder="máx" value={r.max ?? ""} onChange={(e) => onChange({ ...r, enabled: true, max: numIn(e.target.value) })} />
    </label>
  );
}

/** The trade search as the player wants it: filters and mods, then "Buscar". */
function SearchEditor({ p }: { p: PriceView }) {
  const [mods, setMods] = useState<PriceModFilter[]>(p.mods);
  const [f, setF] = useState<PriceFilters>(p.filters);
  // state is re-sent every second as a new object: only reset local edits when the content changes
  const key = `${p.seq}|${JSON.stringify(p.mods)}|${JSON.stringify(p.filters)}`;
  useEffect(() => {
    setMods(p.mods);
    setF(p.filters);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (p.tradeStatus === "n/a") return null;

  const setMod = (i: number, patch: Partial<PriceModFilter>) => setMods((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const setRange = (k: keyof PriceFilters, r: PriceRange) => setF((x) => ({ ...x, [k]: r }));
  const d = p.calc.dps;
  const def = p.calc.def;
  const rareish = p.item.rarity === "Rare" || p.item.rarity === "Magic";
  const ranges: [keyof PriceFilters, string, string | undefined][] = [
    ["pdps", "DPS físico", d ? `${d.pdps}, Q20 ${d.pdpsQ20}` : undefined],
    ["edps", "DPS elemental", d ? String(d.edps) : undefined],
    ["dps", "DPS total", d ? `${d.dps}, Q20 ${d.dpsQ20}` : undefined],
    ["armour", "Armadura", def?.armour ? `${def.armour}, Q20 ${def.armourQ20}` : undefined],
    ["evasion", "Evasão", def?.evasion ? `${def.evasion}, Q20 ${def.evasionQ20}` : undefined],
    ["es", "Energy Shield", def?.es ? `${def.es}, Q20 ${def.esQ20}` : undefined],
    ["ward", "Ward", def?.ward ? String(def.ward) : undefined],
    ["itemLevel", "Item level", p.item.itemLevel !== null ? String(p.item.itemLevel) : undefined],
    ["links", "Links", p.item.links ? String(p.item.links) : undefined],
    ["quality", "Qualidade", p.item.quality ? `${p.item.quality}%` : undefined],
    ["gemLevel", "Nível da gema", p.item.gemLevel !== null ? String(p.item.gemLevel) : undefined],
    ["mapTier", "Tier do mapa", undefined],
  ];

  return (
    <>
      <h3>Busca no trade</h3>
      <div className="search-flags">
        <label className="check small">
          <input type="checkbox" checked={f.online} onChange={(e) => setF({ ...f, online: e.target.checked })} />
          só vendedores online
        </label>
        {rareish && (
          <label className="check small">
            <input type="checkbox" checked={f.baseType} onChange={(e) => setF({ ...f, baseType: e.target.checked })} />
            só esta base ({p.item.baseType})
          </label>
        )}
        <label className="small">
          corrompido{" "}
          <select value={f.corrupted} onChange={(e) => setF({ ...f, corrupted: e.target.value as PriceFilters["corrupted"] })}>
            <option value="any">tanto faz</option>
            <option value="no">não</option>
            <option value="yes">sim</option>
          </select>
        </label>
        {f.influences.map((inf, i) => (
          <label key={inf.name} className="check small">
            <input
              type="checkbox"
              checked={inf.enabled}
              onChange={(e) => setF({ ...f, influences: f.influences.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })}
            />
            {inf.name}
          </label>
        ))}
      </div>
      <div className="mods">
        {ranges.map(([k, label, current]) => {
          const r = f[k] as PriceRange | null;
          return r ? <RangeRow key={k} label={label} r={r} current={current} onChange={(x) => setRange(k, x)} /> : null;
        })}
        {mods.map((m, i) => (
          <label className={`mod${m.kind === "pseudo" ? " pseudo" : ""}`} key={m.statId}>
            <input type="checkbox" checked={m.enabled} onChange={(e) => setMod(i, { enabled: e.target.checked })} />
            <span className={`mod-text kind-${m.kind}`}>
              {m.text}
              {m.kind !== "explicit" ? <span className="muted"> ({KIND_LABEL[m.kind] ?? m.kind})</span> : null}
            </span>
            <input className="mod-min" type="number" placeholder="mín" value={m.min ?? ""} onChange={(e) => setMod(i, { enabled: true, min: numIn(e.target.value) })} />
            <input className="mod-min" type="number" placeholder="máx" value={m.max ?? ""} onChange={(e) => setMod(i, { enabled: true, max: numIn(e.target.value) })} />
          </label>
        ))}
        {p.unmatched.length > 0 && <div className="muted small">Não reconhecidos (fora da busca): {p.unmatched.join(" · ")}</div>}
      </div>
      <div className="row buttons">
        <button
          disabled={p.tradeStatus === "loading"}
          onClick={() =>
            void window.hub.priceResearch({
              mods: mods.map((m) => ({ statId: m.statId, enabled: m.enabled, min: m.min, max: m.max ?? null })),
              filters: f,
            })
          }
        >
          {p.tradeStatus === "loading" ? "Buscando…" : "Buscar"}
        </button>
      </div>
    </>
  );
}

const STATUS_LABEL = { online: "online", afk: "ausente", offline: "offline" };

/** Bulk exchange offers: price per unit, how many per trade, stock, seller. */
function BulkTable({ p }: { p: PriceView }) {
  if (p.bulkStatus === "n/a") return null;
  const cpd = p.chaosPerDivine;
  return (
    <>
      <h3>Troca em massa (bulk)</h3>
      {p.bulkStatus === "loading" && <div className="muted small">buscando ofertas…</div>}
      {p.bulkStatus === "error" && <div className="warn-text small">{p.bulkError}</div>}
      {p.bulk && p.bulk.offers.length === 0 && <div className="muted small">ninguém vendendo agora</div>}
      {p.bulk && p.bulk.offers.length > 0 && (
        <table className="listings">
          <tbody>
            {p.bulk.offers.map((o, i) => {
              // far below poe.ninja: usually a bait listing (1 in stock, never answers)
              const bait = !!p.ninja && o.chaosPerUnit !== null && o.chaosPerUnit < p.ninja.chaos * 0.6;
              return (
              <tr key={i} className={bait ? "bait" : ""}>
                <td title={bait ? "muito abaixo do poe.ninja: provavelmente isca" : ""}>
                  <b>{o.chaosPerUnit !== null ? fmtChaos(o.chaosPerUnit, cpd) : "?"}</b>
                  <span className="muted"> /un</span>
                  {bait && <span className="warn-text small"> suspeito</span>}
                </td>
                <td className="muted">
                  {fmtAmount(o.pay.amount, o.pay.currency)} → {o.get.amount}
                </td>
                <td className="muted">estoque {o.get.stock}</td>
                <td>
                  <span className={`seller ${o.status}`} title={`${o.seller} · ${STATUS_LABEL[o.status]}`}>
                    {o.character ?? o.seller}
                  </span>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {p.bulk && (
        <div className="muted small">
          {p.bulk.total} ofertas no total ·{" "}
          <a href={p.bulk.url} onClick={(e) => (e.preventDefault(), void window.hub.priceOpenTrade())}>
            abrir no site
          </a>
        </div>
      )}
    </>
  );
}

/** pDPS/eDPS or armour/evasion/ES, now and at 20% quality. */
function CalcLine({ p }: { p: PriceView }) {
  const d = p.calc.dps;
  const def = p.calc.def;
  if (!d && !def) return null;
  const parts: string[] = [];
  if (d) {
    if (d.pdps) parts.push(`pDPS ${d.pdps}${d.pdpsQ20 !== d.pdps ? ` (Q20 ${d.pdpsQ20})` : ""}`);
    if (d.edps) parts.push(`eDPS ${d.edps}`);
    if (d.cdps) parts.push(`caos ${d.cdps}`);
    parts.push(`total ${d.dps}${d.dpsQ20 !== d.dps ? ` (Q20 ${d.dpsQ20})` : ""}`);
  }
  if (def) {
    if (def.armour) parts.push(`armadura ${def.armour}${def.armourQ20 !== def.armour ? ` (Q20 ${def.armourQ20})` : ""}`);
    if (def.evasion) parts.push(`evasão ${def.evasion}${def.evasionQ20 !== def.evasion ? ` (Q20 ${def.evasionQ20})` : ""}`);
    if (def.es) parts.push(`ES ${def.es}${def.esQ20 !== def.es ? ` (Q20 ${def.esQ20})` : ""}`);
    if (def.ward) parts.push(`ward ${def.ward}`);
  }
  return <div className="small calc-line">{parts.join(" · ")}</div>;
}

const tierClass = (t: number | undefined) => (t === 1 ? "tier t1" : t === 2 ? "tier t2" : "tier");

/** "1/3 prefixos · 2/3 sufixos · 2 livres" from the advanced copy. */
export function affixText(a: NonNullable<PriceView["item"]["affixes"]>): string {
  const open = a.maxPrefix - a.prefix + (a.maxSuffix - a.suffix);
  const parts = [`${a.prefix}/${a.maxPrefix} prefixos`, `${a.suffix}/${a.maxSuffix} sufixos`];
  if (open > 0) {
    const where = [a.prefix < a.maxPrefix ? "prefixo" : null, a.suffix < a.maxSuffix ? "sufixo" : null].filter(Boolean).join(" e ");
    parts.push(`espaço para craftar (${where})`);
  } else parts.push("sem espaço livre");
  return parts.join(" · ");
}

/** Overlay line: how many top tiers and the affix room. */
export function TierSummary({ p }: { p: PriceView }) {
  const a = p.item.affixes;
  if (!a) return null;
  const t1 = p.item.mods.filter((m) => m.tier === 1).length;
  const t2 = p.item.mods.filter((m) => m.tier === 2).length;
  return (
    <div className="muted small">
      {t1 ? <span className="tier t1">{t1}× T1</span> : null} {t2 ? <span className="tier t2">{t2}× T2</span> : null} {affixText(a)}
    </div>
  );
}

function ModTiers({ p }: { p: PriceView }) {
  const mods = p.item.mods.filter((m) => m.kind !== "enchant" || m.tier !== undefined);
  if (!p.item.affixes) {
    if (p.item.rarity === "Rare" || p.item.rarity === "Magic") {
      return <p className="muted small">Copie com <b>Ctrl+Alt+C</b> para ver o tier de cada mod e se há espaço para craftar.</p>;
    }
    return null;
  }
  return (
    <>
      <h3>Modificadores</h3>
      <div className="small">{affixText(p.item.affixes)}</div>
      <table className="farm-items">
        <tbody>
          {mods.map((m, i) => (
            <tr key={i}>
              <td className="tier-cell">
                {m.tier !== undefined ? (
                  <span className={tierClass(m.tier)}>T{m.tier}</span>
                ) : m.rank !== undefined ? (
                  <span className="tier">R{m.rank}</span>
                ) : (
                  <span className="muted small">{m.kind === "implicit" ? "impl." : ""}</span>
                )}
              </td>
              <td className={m.kind === "crafted" ? "f-craft" : m.kind === "implicit" ? "f-enter" : m.kind === "fractured" ? "f-quest" : ""}>
                {m.text}
                {m.affix ? <span className="muted small"> · {m.affix === "prefix" ? "prefixo" : "sufixo"}</span> : null}
              </td>
              <td className="roll-cell" title={m.roll !== undefined ? `rolagem ${Math.round(m.roll * 100)}% da faixa` : ""}>
                {m.roll !== undefined && (
                  <div className="roll-bar">
                    <div className="roll-fill" style={{ width: `${Math.round(m.roll * 100)}%` }} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function PricePanelBody({ p }: { p: PriceView | null }) {
  if (!p) {
    return (
      <p className="muted">
        No jogo, passe o mouse sobre um item e aperte <b>Ctrl+D</b> (abre o preço ao lado do item) ou <b>Ctrl+C</b>{" "}
        (o preço aparece aqui e no overlay).
      </p>
    );
  }
  const cpd = p.chaosPerDivine;
  return (
    <>
      <div className="price-item">{itemTitle(p)}</div>
      <div className="muted small">
        {p.item.rarity} · {p.item.itemClass}
        {p.item.itemLevel !== null ? ` · ilvl ${p.item.itemLevel}` : ""} · liga {p.league}
        {cpd ? ` · 1 div = ${Math.round(cpd)} c` : ""}
      </div>
      <PriceSummary p={p} />
      <CalcLine p={p} />
      <ModTiers p={p} />
      {p.ninja && (
        <div className="muted small">
          referência: {p.ninja.label}
          {p.ninja.listings !== null ? ` (${p.ninja.listings} anúncios)` : ""}
        </div>
      )}
      <BulkTable p={p} />
      {p.trade && p.trade.listings.length > 0 && (
        <table className="listings">
          <tbody>
            {p.trade.listings.map((l, i) => (
              <tr key={i}>
                <td>{fmtAmount(l.amount, l.currency)}</td>
                <td className="muted">{l.chaos !== null && l.currency !== "chaos" ? `≈ ${fmtChaos(l.chaos, null)}` : ""}</td>
                <td>
                  <span className={`seller ${l.status}`} title={l.seller}>
                    {l.character ?? l.seller}
                  </span>
                </td>
                <td className="muted">há {ago(l.indexed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.trade && (
        <div className="row buttons">
          <button onClick={() => void window.hub.priceOpenTrade()}>Abrir no site do trade</button>
          {p.trade.more > 0 && <button onClick={() => void window.hub.priceMore()}>Mais resultados ({p.trade.more})</button>}
        </div>
      )}
      <SearchEditor p={p} />
    </>
  );
}
