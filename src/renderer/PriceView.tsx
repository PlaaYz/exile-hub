import { useEffect, useState } from "react";
import type { PriceModFilter, PriceView } from "../shared/types";

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

function ModEditor({ p }: { p: PriceView }) {
  const [mods, setMods] = useState<PriceModFilter[]>(p.mods);
  // state is re-sent every second as a new object: only reset local edits when the content changes
  const modsKey = `${p.seq}|${JSON.stringify(p.mods)}`;
  useEffect(() => setMods(p.mods), [modsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p.mods.length && !p.unmatched.length) return null;

  const set = (i: number, patch: Partial<PriceModFilter>) =>
    setMods((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <>
      <h3>Modificadores usados na busca</h3>
      <div className="mods">
        {mods.map((m, i) => (
          <label className="mod" key={m.statId}>
            <input type="checkbox" checked={m.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} />
            <span className={`mod-text kind-${m.kind}`}>
              {m.text}
              {m.kind !== "explicit" ? <span className="muted"> ({m.kind})</span> : null}
            </span>
            <input
              className="mod-min"
              type="number"
              placeholder="mín"
              value={m.min ?? ""}
              onChange={(e) => set(i, { min: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
        ))}
        {p.unmatched.length > 0 && (
          <div className="muted small">Não reconhecidos (fora da busca): {p.unmatched.join(" · ")}</div>
        )}
      </div>
      <div className="row buttons">
        <button
          disabled={p.tradeStatus === "loading"}
          onClick={() =>
            void window.hub.priceResearch(mods.map((m) => ({ statId: m.statId, enabled: m.enabled, min: m.min })))
          }
        >
          Buscar de novo
        </button>
      </div>
    </>
  );
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
      <ModTiers p={p} />
      {p.ninja && (
        <div className="muted small">
          referência: {p.ninja.label}
          {p.ninja.listings !== null ? ` (${p.ninja.listings} anúncios)` : ""}
        </div>
      )}
      {p.trade && p.trade.listings.length > 0 && (
        <table className="listings">
          <tbody>
            {p.trade.listings.map((l, i) => (
              <tr key={i}>
                <td>{fmtAmount(l.amount, l.currency)}</td>
                <td className="muted">{l.chaos !== null && l.currency !== "chaos" ? `≈ ${fmtChaos(l.chaos, null)}` : ""}</td>
                <td className="muted">há {ago(l.indexed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.trade && (
        <div className="row buttons">
          <button onClick={() => void window.hub.priceOpenTrade()}>Abrir no site do trade</button>
        </div>
      )}
      <ModEditor p={p} />
    </>
  );
}
