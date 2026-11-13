import { useState } from "react";
import { tr } from "../shared/i18n";
import type { AppState } from "../shared/types";
import { TreeMap, TreeMapModal } from "./TreeMap";

type Tree = NonNullable<AppState["tree"]>;

/** The imported build's passive tree, as a guide to follow (the character's own tree is not compared). */
export function TreePanel({ tree }: { tree: Tree }) {
  const [full, setFull] = useState(false);
  const p = tree.progress;
  if (tree.status === "loading" || !p) return <p className="muted small">{tr("Carregando a árvore passiva oficial…", "Loading the official passive tree…")}</p>;
  if (p.buildPoints === 0) {
    return <p className="muted small">{tr("O build importado não tem árvore passiva (ou é de outra versão da árvore).", "The imported build has no passive tree (or it is from another tree version).")}</p>;
  }
  return (
    <>
      <div className="muted small">{tr(`${p.buildPoints} pontos nesta etapa da build`, `${p.buildPoints} points in this stage of the build`)}</div>
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
