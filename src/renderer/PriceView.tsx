import { tr } from "../shared/i18n";
import type { ItemComparison } from "../core/itemCompare";
import type { PriceRecent, PriceView } from "../shared/types";

export function fmtChaos(chaos: number, chaosPerDivine: number | null): string {
  if (chaosPerDivine && chaos >= chaosPerDivine) {
    const d = chaos / chaosPerDivine;
    return `${d >= 10 ? Math.round(d) : d.toFixed(1)} div`;
  }
  if (chaos > 0 && chaos < 0.1) return "<0.1 c";
  return `${chaos >= 10 ? Math.round(chaos) : chaos.toFixed(1)} c`;
}

export function itemTitle(p: PriceView): string {
  const it = p.item;
  const parts = [it.name && it.name !== it.baseType ? `${it.name} — ${it.baseType}` : it.baseType || it.name];
  if (it.gemLevel !== null) parts.push(`${tr("nível", "level")} ${it.gemLevel}${it.quality ? ` / ${it.quality}%` : ""}`);
  if (it.links >= 5) parts.push(`${it.links}L`);
  if (it.stackSize && it.stackSize > 1) parts.push(`x${it.stackSize}`);
  if (it.corrupted) parts.push(tr("corrompido", "corrupted"));
  return parts.join(" · ");
}

/** poe.ninja's last 7 days: a tiny line and the % change (rising = green, falling = red). */
function TrendBadge({ t }: { t: { change: number; points: number[] } }) {
  const pts = [0, ...t.points]; // a week ago is the 0% baseline
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const w = 56;
  const h = 14;
  const d = pts.map((v, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(" ");
  const cls = t.change > 2 ? "up" : t.change < -2 ? "down" : "flat";
  return (
    <span className={`trend ${cls}`} title={tr("variação no poe.ninja nos últimos 7 dias", "poe.ninja change over the last 7 days")}>
      {" "}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polyline points={d} fill="none" strokeWidth="1.5" />
      </svg>{" "}
      {t.change > 0 ? "+" : ""}
      {t.change}% {tr("em 7 dias", "in 7 days")}
    </span>
  );
}

/** Compact lines shared by the overlay card and the dashboard panel. */
export function PriceSummary({ p }: { p: PriceView }) {
  const cpd = p.chaosPerDivine;
  const stack = p.item.stackSize && p.item.stackSize > 1 ? p.item.stackSize : null;
  const rareish = /^(Rare|Magic)$/.test(p.item.rarity);
  return (
    <div className="price-summary">
      <div className="price-line">
        <span className="price-src">poe.ninja</span>
        {p.ninjaStatus === "loading" && <span className="muted">{tr("consultando…", "checking…")}</span>}
        {p.ninjaStatus === "n/a" && <span className="muted">{rareish ? tr("não tem preço para raros e mágicos", "has no prices for rares and magic items") : tr("sem referência", "no reference")}</span>}
        {p.ninjaStatus === "error" && <span className="warn-text">{tr("erro", "error")}: {p.ninjaError}</span>}
        {p.ninjaStatus === "done" && p.ninja && (
          <span>
            <b>{fmtChaos(p.ninja.chaos, cpd)}</b>
            {stack ? <span className="muted"> · {tr("pilha", "stack")}: {fmtChaos(p.ninja.chaos * stack, cpd)}</span> : null}
            {p.ninja.trend && <TrendBadge t={p.ninja.trend} />}
            {p.ninja.lowConfidence && <span className="warn-text"> · {tr("poucos anúncios, desconfie", "few listings, be careful")}</span>}
          </span>
        )}
      </div>
    </div>
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
    if (d.cdps) parts.push(`${tr("caos", "chaos")} ${d.cdps}`);
    parts.push(`total ${d.dps}${d.dpsQ20 !== d.dps ? ` (Q20 ${d.dpsQ20})` : ""}`);
  }
  if (def) {
    if (def.armour) parts.push(`${tr("armadura", "armour")} ${def.armour}${def.armourQ20 !== def.armour ? ` (Q20 ${def.armourQ20})` : ""}`);
    if (def.evasion) parts.push(`${tr("evasão", "evasion")} ${def.evasion}${def.evasionQ20 !== def.evasion ? ` (Q20 ${def.evasionQ20})` : ""}`);
    if (def.es) parts.push(`ES ${def.es}${def.esQ20 !== def.es ? ` (Q20 ${def.esQ20})` : ""}`);
    if (def.ward) parts.push(`ward ${def.ward}`);
  }
  return <div className="small calc-line">{parts.join(" · ")}</div>;
}

const tierClass = (t: number | undefined) => (t === 1 ? "tier t1" : t === 2 ? "tier t2" : "tier");

/** "1/3 prefixos · 2/3 sufixos · 2 livres" from the advanced copy. */
export function affixText(a: NonNullable<PriceView["item"]["affixes"]>): string {
  const open = a.maxPrefix - a.prefix + (a.maxSuffix - a.suffix);
  const parts = [`${a.prefix}/${a.maxPrefix} ${tr("prefixos", "prefixes")}`, `${a.suffix}/${a.maxSuffix} ${tr("sufixos", "suffixes")}`];
  if (open > 0) {
    const where = [a.prefix < a.maxPrefix ? tr("prefixo", "prefix") : null, a.suffix < a.maxSuffix ? tr("sufixo", "suffix") : null]
      .filter(Boolean)
      .join(tr(" e ", " and "));
    parts.push(`${tr("espaço para craftar", "room to craft")} (${where})`);
  } else parts.push(tr("sem espaço livre", "no open affix"));
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
    return null;
  }
  return (
    <>
      <h3>{tr("Modificadores", "Modifiers")}</h3>
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
                {m.affix ? <span className="muted small"> · {m.affix === "prefix" ? tr("prefixo", "prefix") : tr("sufixo", "suffix")}</span> : null}
              </td>
              <td className="roll-cell" title={m.roll !== undefined ? tr(`rolagem ${Math.round(m.roll * 100)}% da faixa`, `roll at ${Math.round(m.roll * 100)}% of the range`) : ""}>
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

/** The comparison's totals in Portuguese (the mod lines themselves stay as the game writes them). */
const TOTAL_PT: [RegExp, string][] = [
  [/total Elemental Resistance/, "resistência elemental total"],
  [/Chaos Resistance/, "resistência a caos"],
  [/to all Attributes/, "todos os atributos"],
  [/total maximum Life/, "vida máxima total"],
  [/total maximum Energy Shield/, "energy shield máximo total"],
  [/total maximum Mana/, "mana máxima total"],
  [/total to Strength/, "força total"],
  [/total to Dexterity/, "destreza total"],
  [/total to Intelligence/, "inteligência total"],
  [/increased Movement Speed/, "velocidade de movimento"],
];
const totalLabel = (label: string) => {
  const hit = TOTAL_PT.find(([re]) => re.test(label));
  return hit ? tr(hit[1].charAt(0).toUpperCase() + hit[1].slice(1), label) : label;
};

const signed = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 10) / 10}`;

/** The checked item against what the imported PoB build wears in the same slot. */
export function CompareBlock({ compare, rarity, hasBuild }: { compare: ItemComparison[] | null; rarity: string; hasBuild: boolean }) {
  if (!compare) {
    if (!hasBuild && (rarity === "Rare" || rarity === "Unique")) {
      return <p className="muted small">{tr("Registre o seu equipamento (botão acima) para comparar com o que você usa.", "Register your equipment (button above) to compare with what you wear.")}</p>;
    }
    return null;
  }
  return (
    <>
      <h3>{tr("Comparado ao seu item", "Compared with your item")}</h3>
      {compare.map((c) => (
        <div key={c.slot} className="compare">
          <div className="small">
            <b>{slotLabel(c.slot)}</b> <span className="muted">· {c.name}</span>{" "}
            <span className={`time-src${c.fromGame ? " log" : ""}`}>{c.fromGame ? tr("registrado no jogo", "registered in game") : tr("do build do PoB", "from the PoB build")}</span>
          </div>
          {c.rows.length > 0 && (
            <table className="farm-items compare-rows">
              <tbody>
                {c.rows.map((r) => {
                  const d = r.candidate - r.equipped;
                  return (
                    <tr key={r.label}>
                      <td>{totalLabel(r.label)}</td>
                      <td className="muted">{Math.round(r.equipped * 10) / 10}</td>
                      <td>→ {Math.round(r.candidate * 10) / 10}</td>
                      <td className={d > 0 ? "good-text" : d < 0 ? "warn-text" : "muted"}>{d === 0 ? "=" : signed(d)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {c.onlyCandidate.length + c.onlyEquipped.length > 0 && (
            <details className="compare-mods small">
              <summary className="muted">
                {tr("Outros mods", "Other mods")}:{" "}
                {c.onlyCandidate.length > 0 && <span className="good-text">{c.onlyCandidate.length} {tr("só neste", "only on this one")}</span>}
                {c.onlyCandidate.length > 0 && c.onlyEquipped.length > 0 && " · "}
                {c.onlyEquipped.length > 0 && <span className="warn-text">{c.onlyEquipped.length} {tr("que você perde", "you lose")}</span>}
              </summary>
              {c.onlyCandidate.length > 0 && (
                <ul>
                  {c.onlyCandidate.map((l) => (
                    <li key={l} className="good-text">+ {l}</li>
                  ))}
                </ul>
              )}
              {c.onlyEquipped.length > 0 && (
                <ul>
                  {c.onlyEquipped.map((l) => (
                    <li key={l} className="warn-text">− {l}</li>
                  ))}
                </ul>
              )}
            </details>
          )}
        </div>
      ))}
    </>
  );
}

export const slotLabel = (s: string) =>
  ({
    "Weapon 1": tr("Arma", "Weapon"),
    "Weapon 2": tr("Segunda mão", "Off hand"),
    Helmet: tr("Elmo", "Helmet"),
    "Body Armour": tr("Armadura", "Body armour"),
    Gloves: tr("Luvas", "Gloves"),
    Boots: tr("Botas", "Boots"),
    Belt: tr("Cinto", "Belt"),
    Amulet: tr("Amuleto", "Amulet"),
    "Ring 1": tr("Anel 1", "Ring 1"),
    "Ring 2": tr("Anel 2", "Ring 2"),
  })[s] ?? s;

/** The last checked items: click to check one again without copying it in the game. */
export function RecentChecks({ recent, current }: { recent: PriceRecent[]; current: number | null }) {
  if (recent.length < 2) return null;
  return (
    <>
      <h3>{tr("Buscas recentes", "Recent checks")}</h3>
      <div className="recent-checks">
        {recent.map((r) => (
          <button key={r.id} className={`small${r.at === current ? " active" : ""}`} title={tr("Checar de novo", "Check again")} onClick={() => void window.hub.priceRecheck(r.id)}>
            {r.name}
            {r.chaos !== null ? <span className="muted"> · {fmtChaos(r.chaos, null)}</span> : null}
          </button>
        ))}
      </div>
    </>
  );
}

export function PricePanelBody({ p, recent = [] }: { p: PriceView | null; recent?: PriceRecent[] }) {
  if (!p) {
    return (
      <>
        <p className="muted">
          {tr("No jogo, passe o mouse sobre um item e aperte", "In game, hover an item and press")} <b>Ctrl+D</b>:{" "}
          {tr("o preço abre ao lado do item, e a aba Equipamento compara com o que você usa.", "the price opens next to the item, and the Equipment tab compares it with what you wear.")}
        </p>
        <RecentChecks recent={recent} current={null} />
      </>
    );
  }
  const cpd = p.chaosPerDivine;
  return (
    <>
      <div className="price-item">{itemTitle(p)}</div>
      <div className="muted small">
        {p.item.rarity} · {p.item.itemClass}
        {p.item.itemLevel !== null ? ` · ilvl ${p.item.itemLevel}` : ""} · {tr("liga", "league")} {p.league}
        {cpd ? ` · 1 div = ${Math.round(cpd)} c` : ""}
      </div>
      <PriceSummary p={p} />
      <CalcLine p={p} />
      <ModTiers p={p} />
      {p.ninja && (
        <div className="muted small">
          {tr("referência:", "reference:")} {p.ninja.label}
          {p.ninja.listings !== null ? ` (${p.ninja.listings} ${tr("anúncios", "listings")})` : ""}
        </div>
      )}
      <RecentChecks recent={recent} current={p.at} />
    </>
  );
}
