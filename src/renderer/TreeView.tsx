import { useState } from "react";
import type { AppState } from "../shared/types";
import { nextNames, TreeMap, TreeMapModal, useTreeLayout } from "./TreeMap";

type Tree = NonNullable<AppState["tree"]>;

function pts(n: number | null): string {
  if (n === null) return "fora do caminho do build";
  return n === 1 ? "1 ponto" : `${n} pontos`;
}

export function TreePanel({ tree }: { tree: Tree }) {
  const [full, setFull] = useState(false);
  const layout = useTreeLayout();
  if (tree.status === "loading") return <p className="muted small">Carregando a árvore passiva oficial…</p>;
  if (tree.status === "no-character" || !tree.progress) {
    return (
      <p className="muted small">
        Ainda não sei qual personagem você está jogando: o Client.txt só diz o nome quando ele sobe de nível.
      </p>
    );
  }
  const p = tree.progress;
  if (p.buildPoints === 0) {
    return <p className="muted small">O build importado não tem árvore passiva (ou é de outra versão da árvore).</p>;
  }
  const pct = Math.round((p.donePoints / p.buildPoints) * 100);
  return (
    <>
      <h3>Árvore passiva — {tree.character}</h3>
      <div className="row">
        <div className="bar">
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="muted">
          {p.donePoints}/{p.buildPoints} pontos do build ({pct}%)
        </span>
      </div>
      {tree.status === "inconsistent" && (
        <div className="warn small">
          O log mostra {tree.pointsSeen} pontos para {tree.character}, mais do que o nível {tree.level} permite (
          {tree.budget}). Provavelmente pontos de outro personagem jogado na mesma sessão entraram na conta: trate
          esta lista como aproximada.
        </div>
      )}
      <div className="tree-mini-wrap">
        <TreeMap progress={p} mode="mini" height={260} />
        <button className="tree-zoom" onClick={() => setFull(true)}>
          ampliar
        </button>
      </div>
      {p.nextPath.length > 0 && (
        <div className="tree-next">
          <span className="muted small">Pegue nesta ordem: </span>
          {nextNames(p, layout, 12).map((n, i) => (
            <span key={i} className="tree-next-step">
              <b>{i + 1}</b> {n}
            </span>
          ))}
          {p.nextPath.length > 12 && <span className="muted small"> … +{p.nextPath.length - 12}</span>}
        </div>
      )}
      {full && <TreeMapModal progress={p} onClose={() => setFull(false)} />}
      {p.missing.length === 0 ? (
        <p className="good">Todos os notables e keystones do build já estão alocados.</p>
      ) : (
        <>
          <div className="muted small">Notables e keystones que faltam, do mais perto para o mais longe:</div>
          <ul className="tree-missing">
            {p.missing.slice(0, 12).map((m) => (
              <li key={m.id} title={m.stats.join("\n")}>
                <span className={m.kind === "keystone" ? "f-asc" : "f-quest"}>{m.name}</span>
                <span className="muted small"> · {pts(m.distance)}</span>
              </li>
            ))}
          </ul>
          {p.missing.length > 12 && <div className="muted small">… e mais {p.missing.length - 12}</div>}
        </>
      )}
      {p.ascMissing.length > 0 && (
        <div className="muted small">Ascendência que falta: {p.ascMissing.join(", ")}</div>
      )}
      {p.offBuild.length > 0 && (
        <div className="muted small">Fora do build (candidatos a respec): {p.offBuild.join(", ")}</div>
      )}
      <div className="muted small">
        Baseado nas linhas "allocated passive" do Client.txt; passe o mouse num notable para ver o que ele dá.
      </div>
    </>
  );
}
