// League challenges: what is left from easiest to hardest (with how to do each one), then the ones
// already completed. The player ticks them: GGG has no API for completed challenges.
import { useEffect, useState } from "react";
import { isDone, orderChallenges, partsNeeded, type Challenge } from "../core/challenges";
import { tr } from "../shared/i18n";
import type { ChallengesView } from "../shared/types";

const difficulty = (d: number) =>
  tr(["", "muito fácil", "fácil", "médio", "difícil", "muito difícil"][d] ?? "", ["", "very easy", "easy", "medium", "hard", "very hard"][d] ?? "");

export function ChallengesPanelBody() {
  const [view, setView] = useState<ChallengesView | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void window.hub.getChallenges().then(setView);
  }, []);

  if (!view) return <div className="muted small">{tr("carregando…", "loading…")}</div>;
  const list = view.list;
  const tick = (id: string, done: boolean, part: number | null = null) => void window.hub.setChallenge(id, done, part).then(setView);
  const refresh = () => {
    setBusy(true);
    void window.hub
      .refreshChallenges()
      .then(setView)
      .finally(() => setBusy(false));
  };

  if (!list || list.challenges.length === 0) {
    return (
      <>
        <p className="muted">
          {tr(
            `A lista de challenges ${list ? `da ${list.patch} ` : ""}ainda não foi publicada. Ela é atualizada no GitHub do projeto quando a liga começa, e o app baixa sozinho, sem precisar de versão nova.`,
            `The ${list ? `${list.patch} ` : ""}challenge list is not published yet. It is updated on the project's GitHub when the league starts, and the app downloads it on its own, no new version needed.`,
          )}
        </p>
        {view.error && <div className="muted small">{view.error}</div>}
        <button disabled={busy} onClick={refresh}>
          {busy ? tr("procurando…", "looking…") : tr("Procurar agora", "Look now")}
        </button>
      </>
    );
  }

  const { todo, done } = orderChallenges(list, view.progress);
  const next = list.rewards.find((r) => r > done.length);

  const row = (c: Challenge) => {
    const finished = isDone(c, view.progress);
    const need = partsNeeded(c);
    const got = view.progress.parts[c.id]?.length ?? 0;
    const expanded = open === c.id;
    return (
      <li key={c.id} className={`chal${finished ? " done" : ""}`}>
        <div className="chal-head">
          <input
            type="checkbox"
            checked={finished}
            title={finished ? tr("desmarcar", "untick") : tr("marcar como completo", "mark as complete")}
            onChange={(e) => tick(c.id, e.target.checked)}
          />
          <button className="link chal-name" onClick={() => setOpen(expanded ? null : c.id)}>
            {c.name}
          </button>
          <span className={`chal-diff d${c.difficulty}`}>{difficulty(c.difficulty)}</span>
          {c.category && <span className="muted small">{c.category}</span>}
          {need > 0 && !finished && (
            <span className="muted small">
              {got}/{need}
            </span>
          )}
        </div>
        {expanded && (
          <div className="chal-body">
            {c.description && <div className="small">{c.description}</div>}
            {c.tips.length > 0 && (
              <ul className="chal-tips">
                {c.tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}
            {c.parts && (
              <div className="chal-parts">
                {c.parts.map((p, i) => (
                  <label key={i} className="check small">
                    <input
                      type="checkbox"
                      checked={view.progress.parts[c.id]?.includes(i) ?? false}
                      onChange={(e) => tick(c.id, e.target.checked, i)}
                    />
                    {p}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      <div className="row">
        <b>
          {done.length}/{list.challenges.length} {tr("completos", "complete")}
        </b>
        {next && <span className="muted small">{tr("próxima recompensa com", "next reward at")} {next}</span>}
        <span className="muted small">
          {list.league}
          {list.updated ? ` · ${tr("lista de", "list from")} ${list.updated}` : ""}
        </span>
        <button className="small" disabled={busy} onClick={refresh}>
          {busy ? tr("atualizando…", "updating…") : tr("atualizar lista", "update list")}
        </button>
      </div>
      <div className="muted small">
        {tr("Marque o que você já fez (o jogo não informa isso para outros programas). Clique num challenge para ver como fazer.", "Tick what you have done (the game does not tell other programs). Click a challenge to see how to do it.")}
      </div>
      <h3>{tr("Falta fazer — do mais fácil ao mais difícil", "To do — easiest first")}</h3>
      <ul className="chal-list">{todo.map(row)}</ul>
      {done.length > 0 && (
        <>
          <h3>{tr("Completos", "Complete")}</h3>
          <ul className="chal-list">{done.map(row)}</ul>
        </>
      )}
      {view.error && <div className="muted small">{view.error} — {tr("usando a última lista salva.", "using the last saved list.")}</div>}
    </>
  );
}
