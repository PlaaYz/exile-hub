import { useState } from "react";
import { tr } from "../shared/i18n";
import type { AppState } from "../shared/types";
import { TreeMap, TreeMapModal } from "./TreeMap";

type Tree = NonNullable<AppState["tree"]>;

export function TreePanel({ tree }: { tree: Tree }) {
  const [full, setFull] = useState(false);
  if (tree.status === "loading") return <p className="muted small">{tr("Carregando a árvore passiva oficial…", "Loading the official passive tree…")}</p>;
  if (!tree.progress) {
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
      {tree.character && <h3>{tree.character}</h3>}
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
      {full && <TreeMapModal progress={p} onClose={() => setFull(false)} />}
    </>
  );
}
