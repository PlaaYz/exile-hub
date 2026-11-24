import { useEffect, useMemo, useState } from "react";
import { MAP_MODS, chromaticSearch, kSearchMax, linkSearchCounts, mapModLabel, mapSearch, movementSearch, type SearchString } from "../core/searchRegex";
import { tr } from "../shared/i18n";

interface LinkPrefs {
  n: number;
  r: number;
  g: number;
  b: number;
}
const DEFAULT_LINKS: LinkPrefs = { n: 4, r: 0, g: 0, b: 0 };

function socketsLabel(l: LinkPrefs): string {
  const parts = [
    l.r && tr(`${l.r} vermelho${l.r > 1 ? "s" : ""}`, `${l.r} red`),
    l.g && tr(`${l.g} verde${l.g > 1 ? "s" : ""}`, `${l.g} green`),
    l.b && tr(`${l.b} azu${l.b > 1 ? "is" : "l"}`, `${l.b} blue`),
  ];
  return parts.filter(Boolean).join(", ");
}
import type { AppState } from "../shared/types";

const LS = "exile-hub.mapSearch.v1";

interface Prefs {
  exclude: string[];
  minQuant: number | null;
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
          {copied === s.text ? tr("Copiado!", "Copied!") : tr("Copiar", "Copy")}
        </button>
      </div>
      <div className={`small ${s.ok ? "muted" : "warn-text"}`}>
        {s.length}/{kSearchMax} {tr("caracteres", "characters")}
        {!s.ok && terms.length > 1 ? tr(" — não cabe: copie as partes separadas abaixo, uma de cada vez", " — too long: copy the parts below one at a time") : ""}
        {!s.ok && terms.length === 1 ? tr(" — não cabe: desmarque algum mod", " — too long: untick a mod") : ""}
      </div>
      {!s.ok && terms.length > 1 && (
        <div className="row buttons">
          {terms.map((t) => (
            <button key={t} disabled={t.length > kSearchMax} onClick={() => copy(t)}>
              {copied === t ? tr("Copiado!", "Copied!") : `${tr("Copiar", "Copy")} ${t.slice(0, 18)}…`}
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
        {tr(
          "No jogo: abra o baú ou o vendedor, clique na busca (Ctrl+F) e cole (Ctrl+V). O app só copia o texto; nada é digitado no jogo por ele.",
          "In game: open the stash or the vendor, click the search box (Ctrl+F) and paste (Ctrl+V). The app only copies the text; it types nothing into the game.",
        )}
      </p>

      <h3>{tr("Mapas", "Maps")}</h3>
      <div className="row">
        <span className="muted small">{tr("Quantidade de itens mínima", "Min item quantity")}</span>
        <input
          className="num"
          type="number"
          min="0"
          max="200"
          placeholder={tr("ex.: 70", "e.g. 70")}
          value={prefs.minQuant ?? ""}
          onChange={(e) => setPrefs((p) => ({ ...p, minQuant: e.target.value === "" ? null : Number(e.target.value) }))}
        />
      </div>
      <div className="mod-pick">
        {sorted.map((m) => (
          <label key={m.id} className="check small">
            <input type="checkbox" checked={prefs.exclude.includes(m.id)} onChange={() => toggle(m.id)} />
            {mapModLabel(m)}
          </label>
        ))}
      </div>
      <CopyBox s={map} title={tr("Mapas sem os mods marcados (busca no seu baú)", "Maps without the ticked mods (stash search)")} />

      <h3>{tr("Vendedor", "Vendor")}</h3>
      <div className="row">
        <span className="muted small">Links</span>
        <select className="narrow-select" value={lp.n} onChange={(e) => setLinks({ n: Number(e.target.value) })}>
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n} {tr("ligados", "linked")}
            </option>
          ))}
        </select>
        {(["r", "g", "b"] as const).map((c) => (
          <label key={c} className="small">
            <span className={`sock sock-${c}`}>{c === "r" ? tr("vermelho", "red") : c === "g" ? tr("verde", "green") : tr("azul", "blue")}</span>{" "}
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
            title={`${tr("Cores do build importado", "Colors of the imported build")}: ${links.gems.slice(0, 6).join(", ")}`}
            onClick={() => {
              const cs = links.colors.slice(0, 6);
              const count = (c: string) => cs.filter((x) => x === c).length;
              setLinks({ n: Math.max(2, cs.length), r: count("r"), g: count("g"), b: count("b") });
            }}
          >
            {tr("usar as cores do build", "use the build's colors")}
          </button>
        )}
      </div>
      {lp.r + lp.g + lp.b > lp.n && <div className="warn small">{tr(`Mais cores do que sockets: só as primeiras ${lp.n} contam.`, `More colors than sockets: only the first ${lp.n} count.`)}</div>}
      <CopyBox s={linkS} title={`${lp.n} ${tr("sockets ligados", "linked sockets")}${lp.r + lp.g + lp.b ? ` ${tr("com", "with")} ${socketsLabel(lp)}` : ""}`} />
      <CopyBox s={chromaticSearch()} title={tr("Vermelho + verde + azul ligados (Chromatic Orb no vendedor)", "Red + green + blue linked (Chromatic Orb at the vendor)")} />
      <CopyBox s={movementSearch()} title={tr("Botas com velocidade de movimento", "Boots with movement speed")} />
    </>
  );
}
