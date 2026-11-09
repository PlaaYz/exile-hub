import { useEffect, useMemo, useState } from "react";
import { MAP_MODS, chromaticSearch, kSearchMax, linkSearchCounts, mapSearch, movementSearch, type SearchString } from "../core/searchRegex";

interface LinkPrefs {
  n: number;
  r: number;
  g: number;
  b: number;
}
const DEFAULT_LINKS: LinkPrefs = { n: 4, r: 0, g: 0, b: 0 };

function socketsLabel(l: LinkPrefs): string {
  const parts = [l.r && `${l.r} vermelho${l.r > 1 ? "s" : ""}`, l.g && `${l.g} verde${l.g > 1 ? "s" : ""}`, l.b && `${l.b} azu${l.b > 1 ? "is" : "l"}`];
  return parts.filter(Boolean).join(", ");
}
import type { AppState } from "../shared/types";

const LS = "exile-hub.mapSearch.v1";

interface Prefs {
  exclude: string[];
  minQuant: number | null;
  minPack?: number | null;
  tierMin?: number | null;
  tierMax?: number | null;
  rarity?: "any" | "rare" | "magic" | "normal";
  corrupted?: "any" | "yes" | "no";
  links?: LinkPrefs;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) return JSON.parse(raw);
  } catch {
    /* storage unavailable */
  }
  return { exclude: ["phys-reflect", "ele-reflect", "no-regen"], minQuant: null };
}

function CopyBox({ s, title }: { s: SearchString; title: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 2500);
    });
  };
  if (!s.text) return null;
  const terms = s.text.match(/"[^"]*"/g) ?? [s.text];
  return (
    <div className="search-box">
      <div className="search-title">{title}</div>
      <div className="row">
        <code className={`search-code${s.ok ? "" : " over"}`}>{s.text}</code>
        <button disabled={!s.ok} onClick={() => copy(s.text)}>
          {copied === s.text ? "Copiado!" : "Copiar"}
        </button>
      </div>
      <div className={`small ${s.ok ? "muted" : "warn-text"}`}>
        {s.length}/{kSearchMax} caracteres
        {!s.ok && terms.length > 1 ? " — não cabe: copie as partes separadas abaixo, uma de cada vez" : ""}
        {!s.ok && terms.length === 1 ? " — não cabe: desmarque algum mod" : ""}
      </div>
      {!s.ok && terms.length > 1 && (
        <div className="row buttons">
          {terms.map((t) => (
            <button key={t} disabled={t.length > kSearchMax} onClick={() => copy(t)}>
              {copied === t ? "Copiado!" : `Copiar ${t.slice(0, 18)}…`}
            </button>
          ))}
        </div>
      )}
      <ul className="search-parts">
        {s.parts.map((p) => (
          <li key={p} className="muted small">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TradeButton({ prefs }: { prefs: Prefs }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const open = async () => {
    setBusy(true);
    setMsg(null);
    const r = await window.hub.openMapTrade({
      exclude: prefs.exclude,
      minQuantity: prefs.minQuant,
      minPackSize: prefs.minPack ?? null,
      tierMin: prefs.tierMin ?? null,
      tierMax: prefs.tierMax ?? null,
      rarity: prefs.rarity ?? "any",
      corrupted: prefs.corrupted ?? "any",
    });
    setBusy(false);
    if (!r.ok) return setMsg({ text: r.error ?? "não foi possível abrir o trade", warn: true });
    const parts = [r.total !== undefined ? `trade aberto no navegador: ${r.total} mapas à venda` : "trade aberto no navegador"];
    if (r.missing.length) parts.push(`sem filtro no trade para: ${r.missing.join(", ")}`);
    setMsg({ text: parts.join(" · "), warn: r.missing.length > 0 });
  };
  return (
    <div className="row">
      <button className="primary" disabled={busy} onClick={() => void open()}>
        {busy ? "Abrindo…" : "Comprar no trade com estes filtros"}
      </button>
      {msg && <span className={`small ${msg.warn ? "warn-text" : "muted"}`}>{msg.text}</span>}
    </div>
  );
}

export function SearchPanelBody({ state }: { state: AppState }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  useEffect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);
  const map = useMemo(() => mapSearch(prefs.exclude, prefs.minQuant), [prefs]);
  const links = state.buildLinks;
  const lp = prefs.links ?? DEFAULT_LINKS;
  const setLinks = (patch: Partial<LinkPrefs>) => setPrefs((p) => ({ ...p, links: { ...(p.links ?? DEFAULT_LINKS), ...patch } }));
  const linkS = useMemo(() => linkSearchCounts(lp.n, lp.r, lp.g, lp.b), [lp.n, lp.r, lp.g, lp.b]);
  const toggle = (id: string) =>
    setPrefs((p) => ({ ...p, exclude: p.exclude.includes(id) ? p.exclude.filter((x) => x !== id) : [...p.exclude, id] }));
  const sorted = [...MAP_MODS].sort((a, b) => Number(!!b.common) - Number(!!a.common));

  return (
    <>
      <p className="muted small">
        No jogo: abra o baú ou o vendedor, clique na busca (Ctrl+F) e cole (Ctrl+V). O app só copia o texto; nada é
        digitado no jogo por ele.
      </p>

      <h3>Mapas</h3>
      <div className="row">
        <span className="muted small">Tier</span>
        <input className="num narrow" type="number" min="1" max="17" placeholder="mín" value={prefs.tierMin ?? ""}
          onChange={(e) => setPrefs((p) => ({ ...p, tierMin: e.target.value === "" ? null : Number(e.target.value) }))} />
        <input className="num narrow" type="number" min="1" max="17" placeholder="máx" value={prefs.tierMax ?? ""}
          onChange={(e) => setPrefs((p) => ({ ...p, tierMax: e.target.value === "" ? null : Number(e.target.value) }))} />
        <span className="muted small">Pack size mín.</span>
        <input className="num narrow" type="number" min="0" placeholder="%" value={prefs.minPack ?? ""}
          onChange={(e) => setPrefs((p) => ({ ...p, minPack: e.target.value === "" ? null : Number(e.target.value) }))} />
        <select className="narrow-select" value={prefs.rarity ?? "any"} onChange={(e) => setPrefs((p) => ({ ...p, rarity: e.target.value as Prefs["rarity"] }))}>
          <option value="any">qualquer raridade</option>
          <option value="rare">raro</option>
          <option value="magic">mágico</option>
          <option value="normal">normal</option>
        </select>
        <select className="narrow-select" value={prefs.corrupted ?? "any"} onChange={(e) => setPrefs((p) => ({ ...p, corrupted: e.target.value as Prefs["corrupted"] }))}>
          <option value="any">corrompido ou não</option>
          <option value="no">não corrompido</option>
          <option value="yes">só corrompido</option>
        </select>
      </div>
      <div className="row">
        <span className="muted small">Quantidade de itens mínima</span>
        <input
          className="num"
          type="number"
          min="0"
          max="200"
          placeholder="ex.: 70"
          value={prefs.minQuant ?? ""}
          onChange={(e) => setPrefs((p) => ({ ...p, minQuant: e.target.value === "" ? null : Number(e.target.value) }))}
        />
      </div>
      <div className="mod-pick">
        {sorted.map((m) => (
          <label key={m.id} className="check small">
            <input type="checkbox" checked={prefs.exclude.includes(m.id)} onChange={() => toggle(m.id)} />
            {m.label}
          </label>
        ))}
      </div>
      <CopyBox s={map} title="Mapas sem os mods marcados (busca no seu baú)" />
      <TradeButton prefs={prefs} />
      <p className="muted small">
        O botão abre o site oficial de trade com os mesmos filtros (tier, quantidade, pack size, raridade e "nenhum
        destes mods"), do mais barato para o mais caro. No trade não existe limite de 50 caracteres: todos os mods
        marcados entram.
      </p>

      <h3>Vendedor</h3>
      <div className="row">
        <span className="muted small">Links</span>
        <select className="narrow-select" value={lp.n} onChange={(e) => setLinks({ n: Number(e.target.value) })}>
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n} ligados
            </option>
          ))}
        </select>
        {(["r", "g", "b"] as const).map((c) => (
          <label key={c} className="small">
            <span className={`sock sock-${c}`}>{c === "r" ? "vermelho" : c === "g" ? "verde" : "azul"}</span>{" "}
            <input
              className="num narrow"
              type="number"
              min="0"
              max={lp.n}
              value={lp[c]}
              onChange={(e) => setLinks({ [c]: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
        ))}
        {links && links.colors.length >= 2 && (
          <button
            className="small"
            title={`Cores do build importado: ${links.gems.slice(0, 6).join(", ")}`}
            onClick={() => {
              const cs = links.colors.slice(0, 6);
              const count = (c: string) => cs.filter((x) => x === c).length;
              setLinks({ n: Math.max(2, cs.length), r: count("r"), g: count("g"), b: count("b") });
            }}
          >
            usar as cores do build
          </button>
        )}
      </div>
      {lp.r + lp.g + lp.b > lp.n && <div className="warn small">Mais cores do que sockets: só as primeiras {lp.n} contam.</div>}
      <CopyBox s={linkS} title={`${lp.n} sockets ligados${lp.r + lp.g + lp.b ? ` com ${socketsLabel(lp)}` : ""}`} />
      <CopyBox s={chromaticSearch()} title="Vermelho + verde + azul ligados (Chromatic Orb no vendedor)" />
      <CopyBox s={movementSearch()} title="Botas com velocidade de movimento" />
    </>
  );
}
