import { useState } from "react";
import { tr } from "../shared/i18n";
import type { AppState } from "../shared/types";
import { nextNames, TreeMap, TreeMapModal, useTreeLayout } from "./TreeMap";

type Tree = NonNullable<AppState["tree"]>;

function pts(n: number | null): string {
  if (n === null) return tr("fora do caminho do build", "off the build's path");
  return n === 1 ? tr("1 ponto", "1 point") : tr(`${n} pontos`, `${n} points`);
}

export function TreePanel({ tree }: { tree: Tree }) {
  const [full, setFull] = useState(false);
  const layout = useTreeLayout();
  if (tree.status === "loading") return <p className="muted small">{tr("Carregando a árvore passiva oficial…", "Loading the official passive tree…")}</p>;
  if (tree.status === "no-character" || !tree.progress) {
    return (
      <p className="muted small">
        {tr(
          "Ainda não sei qual personagem você está jogando: escolha no seletor \"quem está jogando?\" no topo, ou suba de nível no jogo (o Client.txt só diz o nome no level up).",
          "I do not know which character you are playing yet: pick it in the \"who is playing?\" selector at the top, or level up in game (Client.txt only names it on level-ups).",
        )}
      </p>
    );
  }
  const p = tree.progress;
  if (p.buildPoints === 0) {
    return <p className="muted small">{tr("O build importado não tem árvore passiva (ou é de outra versão da árvore).", "The imported build has no passive tree (or it is from another tree version).")}</p>;
  }
  const pct = Math.round((p.donePoints / p.buildPoints) * 100);
  return (
    <>
      <h3>{tr("Árvore passiva", "Passive tree")} — {tree.character}</h3>
      <div className="row">
        <div className="bar">
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="muted">
          {p.donePoints}/{p.buildPoints} {tr("pontos do build", "build points")} ({pct}%)
        </span>
      </div>
      {tree.status === "inconsistent" && (
        <div className="warn small">
          {tr(
            `O log mostra ${tree.pointsSeen} pontos para ${tree.character}, mais do que o nível ${tree.level} permite (${tree.budget}). Provavelmente pontos de outro personagem jogado na mesma sessão entraram na conta: trate esta lista como aproximada.`,
            `The log shows ${tree.pointsSeen} points for ${tree.character}, more than level ${tree.level} allows (${tree.budget}). Points of another character played in the same session probably got counted: treat this list as approximate.`,
          )}
        </div>
      )}
      <div className="tree-mini-wrap">
        <TreeMap progress={p} mode="mini" height={260} />
        <button className="tree-zoom" onClick={() => setFull(true)}>
          {tr("ampliar", "enlarge")}
        </button>
      </div>
      {p.nextPath.length > 0 && (
        <div className="tree-next">
          <span className="muted small">{tr("Pegue nesta ordem: ", "Take them in this order: ")}</span>
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
        <p className="good">{tr("Todos os notables e keystones do build já estão alocados.", "Every notable and keystone of the build is allocated.")}</p>
      ) : (
        <>
          <div className="muted small">{tr("Notables e keystones que faltam, do mais perto para o mais longe:", "Missing notables and keystones, nearest first:")}</div>
          <ul className="tree-missing">
            {p.missing.slice(0, 12).map((m) => (
              <li key={m.id} title={m.stats.join("\n")}>
                <span className={m.kind === "keystone" ? "f-asc" : "f-quest"}>{m.name}</span>
                <span className="muted small"> · {pts(m.distance)}</span>
              </li>
            ))}
          </ul>
          {p.missing.length > 12 && <div className="muted small">… {tr("e mais", "and")} {p.missing.length - 12}{tr("", " more")}</div>}
        </>
      )}
      {p.ascMissing.length > 0 && (
        <div className="muted small">{tr("Ascendência que falta:", "Missing ascendancy:")} {p.ascMissing.join(", ")}</div>
      )}
      {p.offBuild.length > 0 && (
        <div className="muted small">{tr("Fora do build (candidatos a respec):", "Off the build (respec candidates):")} {p.offBuild.join(", ")}</div>
      )}
      <div className="muted small">
        {tr('Baseado nas linhas "allocated passive" do Client.txt; passe o mouse num notable para ver o que ele dá.', 'Based on the "allocated passive" lines of Client.txt; hover a notable to see what it gives.')}
      </div>
    </>
  );
}
