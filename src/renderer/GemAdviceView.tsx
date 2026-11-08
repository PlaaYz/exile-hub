import type { AppState, GemStats } from "../shared/types";

type Advice = AppState["gemAdvice"];

const pct = (g: number) => `${g >= 0 ? "+" : ""}${Math.round(g * 100)}%`;
const num = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));

/** "aguenta X s lançando sem parar" from PoB's mana numbers. */
function sustainText(s: GemStats): string {
  if (s.sustain < 0) return "a regen aguenta lançar sem parar";
  return `${num(s.sustain)} s lançando sem parar até zerar a mana`;
}

function manaDelta(base: GemStats, s: GemStats): { text: string; warn: boolean } {
  const up = base.cost > 0 ? s.cost / base.cost - 1 : 0;
  const text = `mana ${num(base.cost)} → ${num(s.cost)}/uso`;
  // warn when the extra cost cuts non-stop casting time a lot
  const warn = up > 0.25 && s.sustain >= 0 && (base.sustain < 0 || s.sustain < base.sustain * 0.75);
  return { text, warn };
}

/** Overlay line: the best support to get now. */
export function GemHint({ advice }: { advice: Advice }) {
  const r = advice.status === "ok" ? advice.result : null;
  const best = r?.singles?.[0];
  if (!r || !best || !r.base) return null;
  const m = manaDelta(r.base, best);
  return (
    <div className="ov-gems">
      suporte: <b>{best.name}</b> {pct(best.gain)} DPS · <span className={m.warn ? "warn-text" : ""}>{m.text}</span>
    </div>
  );
}

export function GemAdvicePanel({ advice, onRefresh }: { advice: Advice; onRefresh: () => void }) {
  const r = advice.result;
  const header = (
    <>
      <div className="row">
        <h3 style={{ margin: 0, flex: 1 }}>Próxima gema de suporte (motor do PoB)</h3>
        <button disabled={advice.status === "computing"} onClick={onRefresh}>
          {advice.status === "computing" ? "Calculando…" : "Recalcular"}
        </button>
      </div>
      {advice.mismatch && (
        <div className="warn small">
          Atenção: {advice.mismatch}. As gemas disponíveis seguem a sua classe, mas a habilidade calculada é a do build:
          importe o build do personagem atual (copie o código no PoB).
        </div>
      )}
    </>
  );
  if (advice.status !== "ok" || !r?.base) {
    return (
      <>
        {header}
        <p className={`small ${advice.status === "error" || advice.status === "no-pob" ? "warn-text" : "muted"}`}>
          {advice.message ?? "—"}
          {advice.status === "no-pob" ? " Instale o Path of Building Community para usar esta função." : ""}
        </p>
      </>
    );
  }
  const base = r.base;
  return (
    <>
      {header}
      <div className="muted small">
        {r.skill} nível {r.skillLevel} · personagem nível {advice.level}, ato {advice.act} · suportes que você já
        consegue pegar · {r.ms} ms
      </div>
      <div className="small">
        Sem suporte: {num(base.dps)} DPS · mana {num(base.cost)}/uso · {sustainText(base)}
      </div>
      {!r.singles?.length ? (
        <p className="muted small">Nenhum suporte disponível agora aumenta o DPS desta habilidade.</p>
      ) : (
        <table className="farm-items gem-table">
          <thead>
            <tr>
              <th>Suporte</th>
              <th>DPS</th>
              <th>Mana</th>
              <th>Onde pegar</th>
            </tr>
          </thead>
          <tbody>
            {r.singles.map((s, i) => {
              const m = manaDelta(base, s);
              return (
                <tr key={s.id} className={i === 0 ? "sel" : ""}>
                  <td>
                    <b>{s.name}</b> <span className="muted small">nv {s.level}</span>
                  </td>
                  <td className="num-cell good">{pct(s.gain)}</td>
                  <td className={`num-cell small${m.warn ? " warn-text" : ""}`} title={sustainText(s)}>
                    {num(base.cost)} → {num(s.cost)}
                    {s.regen > base.regen * 1.05 ? " · +regen" : ""}
                  </td>
                  <td className="muted small">{advice.sources[s.id] ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {r.combo && r.combo.length > 1 && (
        <div className="small">
          <b>Melhor combinação:</b>{" "}
          {r.combo.map((c, i) => (
            <span key={c.id}>
              {i > 0 ? " + " : ""}
              {c.name}
            </span>
          ))}{" "}
          = <span className="good">{pct(r.combo[r.combo.length - 1].gain)} DPS</span> · mana {num(base.cost)} →{" "}
          {num(r.combo[r.combo.length - 1].cost)}/uso · {sustainText(r.combo[r.combo.length - 1])}
          <div className="muted small">
            Por links: {r.combo.map((c, i) => `${i + 2}L ${pct(c.gain)}`).join(" · ")}
          </div>
        </div>
      )}
      <p className="muted small">
        Calculado pelo próprio Path of Building, com a habilidade principal do seu build, sem árvore e sem itens (só a
        arma), como um personagem de campanha. O ganho de DPS é comparativo; a mana real depende dos seus itens. Mana em
        amarelo: o custo extra encurta bastante quanto tempo você consegue lançar sem parar.
      </p>
    </>
  );
}
