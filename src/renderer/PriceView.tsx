import { useEffect, useState } from "react";
import { tr } from "../shared/i18n";
import type { ItemComparison } from "../core/itemCompare";
import type { PriceFilters, PriceModFilter, PriceRange, PriceRecent, PriceView, SellerStatus, TradeStatus } from "../shared/types";

const CURRENCY_SHORT: Record<string, string> = { chaos: "c", divine: "div", exalted: "ex" };

export function fmtChaos(chaos: number, chaosPerDivine: number | null): string {
  if (chaosPerDivine && chaos >= chaosPerDivine) {
    const d = chaos / chaosPerDivine;
    return `${d >= 10 ? Math.round(d) : d.toFixed(1)} div`;
  }
  if (chaos > 0 && chaos < 0.1) return "<0.1 c";
  return `${chaos >= 10 ? Math.round(chaos) : chaos.toFixed(1)} c`;
}

/** "~3 c", but "<0.1 c" already says it is approximate. */
const approx = (text: string, sign: string) => (text.startsWith("<") ? text : sign + text);

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
  // poe.ninja has no prices for rares / magic items: don't show an empty line for them
  const showNinja = !(p.ninjaStatus === "n/a" && /^(Rare|Magic)$/.test(p.item.rarity));
  return (
    <div className="price-summary">
      {showNinja && <div className="price-line">
        <span className="price-src">poe.ninja</span>
        {p.ninjaStatus === "loading" && <span className="muted">{tr("consultando…", "checking…")}</span>}
        {p.ninjaStatus === "n/a" && <span className="muted">{tr("sem referência", "no reference")}</span>}
        {p.ninjaStatus === "error" && <span className="warn-text">{tr("erro", "error")}: {p.ninjaError}</span>}
        {p.ninjaStatus === "done" && p.ninja && (
          <span>
            <b>{fmtChaos(p.ninja.chaos, cpd)}</b>
            {stack ? <span className="muted"> · {tr("pilha", "stack")}: {fmtChaos(p.ninja.chaos * stack, cpd)}</span> : null}
            {p.ninja.trend && <TrendBadge t={p.ninja.trend} />}
            {p.ninja.lowConfidence && <span className="warn-text"> · {tr("poucos anúncios, desconfie", "few listings, be careful")}</span>}
          </span>
        )}
      </div>}
      {p.tradeStatus !== "n/a" && (
        <div className="price-line">
          <span className="price-src">trade</span>
          {p.tradeStatus === "loading" && <span className="muted">{tr("buscando…", "searching…")}</span>}
          {p.tradeStatus === "error" && <span className="warn-text">{p.tradeError}</span>}
          {p.tradeStatus === "done" && p.trade && (
            p.trade.total === 0 ? (
              <span className="muted">{tr("nenhum anúncio parecido", "no similar listings")}</span>
            ) : (
              <span>
                {p.trade.medianChaos !== null ? <b>{approx(fmtChaos(p.trade.medianChaos, cpd), "~")}</b> : null}
                <span className="muted">
                  {" "}
                  · {tr("mais barato", "cheapest")} {fmtAmount(p.trade.listings[0].amount, p.trade.listings[0].currency)} · {p.trade.total}{" "}
                  {tr("anúncios", "listings")}
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

const kindLabel = (k: string) =>
  ({
    pseudo: tr("total", "total"),
    implicit: tr("implícito", "implicit"),
    crafted: tr("craftado", "crafted"),
    fractured: tr("fraturado", "fractured"),
    enchant: tr("encantamento", "enchant"),
  })[k] ?? k;

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
      <input className="mod-min" type="number" placeholder={tr("mín", "min")} value={r.min ?? ""} onChange={(e) => onChange({ ...r, enabled: true, min: numIn(e.target.value) })} />
      <input className="mod-min" type="number" placeholder={tr("máx", "max")} value={r.max ?? ""} onChange={(e) => onChange({ ...r, enabled: true, max: numIn(e.target.value) })} />
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
    ["pdps", tr("DPS físico", "Physical DPS"), d ? `${d.pdps}, Q20 ${d.pdpsQ20}` : undefined],
    ["edps", tr("DPS elemental", "Elemental DPS"), d ? String(d.edps) : undefined],
    ["dps", "DPS total", d ? `${d.dps}, Q20 ${d.dpsQ20}` : undefined],
    ["armour", tr("Armadura", "Armour"), def?.armour ? `${def.armour}, Q20 ${def.armourQ20}` : undefined],
    ["evasion", tr("Evasão", "Evasion"), def?.evasion ? `${def.evasion}, Q20 ${def.evasionQ20}` : undefined],
    ["es", "Energy Shield", def?.es ? `${def.es}, Q20 ${def.esQ20}` : undefined],
    ["ward", "Ward", def?.ward ? String(def.ward) : undefined],
    ["itemLevel", "Item level", p.item.itemLevel !== null ? String(p.item.itemLevel) : undefined],
    ["links", "Links", p.item.links ? String(p.item.links) : undefined],
    ["quality", tr("Qualidade", "Quality"), p.item.quality ? `${p.item.quality}%` : undefined],
    ["gemLevel", tr("Nível da gema", "Gem level"), p.item.gemLevel !== null ? String(p.item.gemLevel) : undefined],
    ["mapTier", tr("Tier do mapa", "Map tier"), undefined],
  ];

  return (
    <>
      <h3>{tr("Busca no trade", "Trade search")}</h3>
      <div className="search-flags">
        <label className="small">
          {tr("venda:", "sale:")}{" "}
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as TradeStatus })}>
            {TRADE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tradeStatusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        {rareish && (
          <label className="check small">
            <input type="checkbox" checked={f.baseType} onChange={(e) => setF({ ...f, baseType: e.target.checked })} />
            {tr("só esta base", "this base only")} ({p.item.baseType})
          </label>
        )}
        <label className="small">
          {tr("corrompido", "corrupted")}{" "}
          <select value={f.corrupted} onChange={(e) => setF({ ...f, corrupted: e.target.value as PriceFilters["corrupted"] })}>
            <option value="any">{tr("tanto faz", "either")}</option>
            <option value="no">{tr("não", "no")}</option>
            <option value="yes">{tr("sim", "yes")}</option>
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
              {m.kind !== "explicit" ? <span className="muted"> ({kindLabel(m.kind)})</span> : null}
            </span>
            <input className="mod-min" type="number" placeholder={tr("mín", "min")} value={m.min ?? ""} onChange={(e) => setMod(i, { enabled: true, min: numIn(e.target.value) })} />
            <input className="mod-min" type="number" placeholder={tr("máx", "max")} value={m.max ?? ""} onChange={(e) => setMod(i, { enabled: true, max: numIn(e.target.value) })} />
          </label>
        ))}
        {p.unmatched.length > 0 && <div className="muted small">{tr("Não reconhecidos (fora da busca):", "Not recognised (left out of the search):")} {p.unmatched.join(" · ")}</div>}
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
          {p.tradeStatus === "loading" ? tr("Buscando…", "Searching…") : tr("Buscar", "Search")}
        </button>
      </div>
    </>
  );
}

/** One click = the listing's whisper typed in the game's chat (the game comes to the front). */
function WhisperButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | string>("idle");
  const send = async () => {
    setState("busy");
    const err = await window.hub.priceWhisper(text).catch((e: unknown) => String(e));
    setState(err ?? "sent");
  };
  const failed = state !== "idle" && state !== "busy" && state !== "sent";
  return (
    <button
      className={`whisper${failed ? " bad" : ""}`}
      disabled={state === "busy"}
      onClick={() => void send()}
      title={failed ? state : tr(`Mandar whisper no jogo:
${text}`, `Whisper in game:
${text}`)}
    >
      {state === "sent" ? tr("enviado ✓", "sent ✓") : failed ? tr("falhou", "failed") : "whisper"}
    </button>
  );
}

const statusLabel = (s: SellerStatus) =>
  ({ online: "online", afk: tr("ausente", "away"), offline: "offline", instant: tr("compra instantânea", "instant buyout") })[s];

/** The trade site's sale types, in its order (the search always starts at instant buyout). */
const TRADE_STATUSES: TradeStatus[] = ["available", "securable", "onlineleague", "online", "any"];
const tradeStatusLabel = (s: TradeStatus) =>
  ({
    available: tr("Compra instantânea e pessoalmente", "Instant buyout and in person"),
    securable: tr("Compra instantânea", "Instant buyout"),
    onlineleague: tr("Pessoalmente (online na liga)", "In person (online in league)"),
    online: tr("Pessoalmente (online)", "In person (online)"),
    any: tr("Qualquer", "Any"),
  })[s];

/** Bulk exchange offers: price per unit, how many per trade, stock, seller. */
function BulkTable({ p }: { p: PriceView }) {
  if (p.bulkStatus === "n/a") return null;
  const cpd = p.chaosPerDivine;
  return (
    <>
      <h3>{tr("Troca em massa (bulk)", "Bulk exchange")}</h3>
      {p.bulkStatus === "loading" && <div className="muted small">{tr("buscando ofertas…", "looking for offers…")}</div>}
      {p.bulkStatus === "error" && <div className="warn-text small">{p.bulkError}</div>}
      {p.bulk && p.bulk.offers.length === 0 && <div className="muted small">{tr("ninguém vendendo agora", "nobody selling right now")}</div>}
      {p.bulk && p.bulk.offers.length > 0 && (
        <table className="listings">
          <tbody>
            {p.bulk.offers.map((o, i) => {
              // far below poe.ninja: usually a bait listing (1 in stock, never answers)
              const bait = !!p.ninja && o.chaosPerUnit !== null && o.chaosPerUnit < p.ninja.chaos * 0.6;
              return (
              <tr key={i} className={bait ? "bait" : ""}>
                <td title={bait ? tr("muito abaixo do poe.ninja: provavelmente isca", "far below poe.ninja: probably bait") : ""}>
                  <b>{o.chaosPerUnit !== null ? fmtChaos(o.chaosPerUnit, cpd) : "?"}</b>
                  <span className="muted"> /{tr("un", "ea")}</span>
                  {bait && <span className="warn-text small"> {tr("suspeito", "suspicious")}</span>}
                </td>
                <td className="muted">
                  {fmtAmount(o.pay.amount, o.pay.currency)} → {o.get.amount}
                </td>
                <td className="muted">{tr("estoque", "stock")} {o.get.stock}</td>
                <td>
                  <span className={`seller ${o.status}`} title={`${o.seller} · ${statusLabel(o.status)}`}>
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
          {p.bulk.total} {tr("ofertas no total", "offers in total")} ·{" "}
          <a href={p.bulk.url} onClick={(e) => (e.preventDefault(), void window.hub.priceOpenTrade())}>
            {tr("abrir no site", "open on the site")}
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
    if (p.item.rarity === "Rare" || p.item.rarity === "Magic") {
      return <p className="muted small">{tr("Copie com", "Copy with")} <b>Ctrl+Alt+C</b> {tr("para ver o tier de cada mod e se há espaço para craftar.", "to see each mod's tier and whether there is room to craft.")}</p>;
    }
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
      return <p className="muted small">{tr("Importe seu build do Path of Building (copie o código) para comparar com o item que você usa.", "Import your Path of Building build (copy the code) to compare with the item you wear.")}</p>;
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

/** Few results: what the same search finds with every minimum 20% lower. */
function SimilarBlock({ p }: { p: PriceView }) {
  const s = p.similar;
  if (!s || !p.trade) return null;
  return (
    <div className="similar small">
      <b>{tr("Poucos anúncios iguais.", "Few identical listings.")}</b> {tr("Itens parecidos (mínimos 20% menores):", "Similar items (minimums 20% lower):")} {s.total} {tr("anúncios", "listings")}
      {s.medianChaos !== null ? (
        <>
          , {tr("mediana", "median")} <b>{fmtChaos(s.medianChaos, p.chaosPerDivine)}</b>
        </>
      ) : null}
      {s.listings.length > 0 && <span className="muted"> · {s.listings.map((l) => fmtAmount(l.amount, l.currency)).join(", ")}</span>}
    </div>
  );
}

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
          {tr("No jogo, passe o mouse sobre um item e aperte", "In game, hover an item and press")} <b>Ctrl+D</b>{" "}
          {tr("(abre o preço ao lado do item). O Ctrl+C manda o item para a aba Equipamento, para comparar com o que você usa.", "(opens the price next to the item). Ctrl+C sends the item to the Equipment tab, to compare with what you wear.")}
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
      <SimilarBlock p={p} />
      <CalcLine p={p} />
      <ModTiers p={p} />
      {p.ninja && (
        <div className="muted small">
          {tr("referência:", "reference:")} {p.ninja.label}
          {p.ninja.listings !== null ? ` (${p.ninja.listings} ${tr("anúncios", "listings")})` : ""}
        </div>
      )}
      <BulkTable p={p} />
      {p.trade && p.trade.listings.length > 0 && (
        <table className="listings">
          <tbody>
            {p.trade.listings.map((l, i) => (
              <tr key={i}>
                <td>{fmtAmount(l.amount, l.currency)}</td>
                <td className="muted">{l.chaos !== null && l.currency !== "chaos" ? approx(fmtChaos(l.chaos, null), "≈ ") : ""}</td>
                <td>
                  <span className={`seller ${l.status}`} title={`${l.seller} · ${statusLabel(l.status)}`}>
                    {l.character ?? l.seller}
                  </span>
                  {l.whisper && <WhisperButton text={l.whisper} />}
                </td>
                <td className="muted">{tr(`há ${ago(l.indexed)}`, `${ago(l.indexed)} ago`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.trade && (
        <div className="row buttons">
          <button onClick={() => void window.hub.priceOpenTrade()}>{tr("Abrir no site do trade", "Open on the trade site")}</button>
          {p.trade.more > 0 && <button onClick={() => void window.hub.priceMore()}>{tr("Mais resultados", "More results")} ({p.trade.more})</button>}
        </div>
      )}
      <SearchEditor p={p} />
      <RecentChecks recent={recent} current={p.at} />
    </>
  );
}
