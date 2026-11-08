import { fmtMs, useHubState } from "./hooks";
import { PriceSummary, TierSummary, itemTitle } from "./PriceView";
import { Frags, StepView } from "./StepView";
import { MapHint } from "./MapsView";
import { TreeHint } from "./TreeView";
import { GemHint } from "./GemAdviceView";

const kOverlayMaxSteps = 9;
const kPriceCardMs = 25_000; // how long a price stays on the overlay after Ctrl+C

export function OverlayApp() {
  const state = useHubState();
  if (!state) return null;
  const { tracker: t, timers, build, characterLevel } = state;
  const interactive = state.overlayInteractive;

  const nextGems =
    build && characterLevel !== null
      ? build.groups
          .flatMap((g) => g.gems)
          .filter((g) => g.requiredLevel !== null && g.requiredLevel > characterLevel && g.requiredLevel <= characterLevel + 4)
          .slice(0, 4)
      : [];

  const price = state.price && Date.now() - state.price.at < kPriceCardMs ? state.price : null;

  return (
    <div className={`overlay${interactive ? " interactive" : ""}`}>
      {price && (
        <div className="ov-price">
          <div className="ov-price-item">{itemTitle(price)}</div>
          <PriceSummary p={price} />
          <TierSummary p={price} />
        </div>
      )}
      <MapHint maps={state.maps} />
      <div className="ov-head">
        <span className="ov-area">{state.areaName ?? "aguardando uma zona…"}</span>
        <span className="ov-meta">
          Ato {t.act || "–"} · {fmtMs(timers.actMs)}
          {characterLevel !== null ? ` · nível ${characterLevel}` : ""}
        </span>
      </div>

      {state.logStatus !== "watching" && <div className="ov-warn">Client.txt não conectado — abra o painel</div>}
      {t.offRoute && <div className="ov-warn">fora da rota — sincronize no painel</div>}

      {t.done ? (
        <div className="ov-done">Rota da campanha concluída</div>
      ) : (
        <ul className="steps">
          {t.block.slice(0, kOverlayMaxSteps).map((s) => (
            <StepView key={s.id} step={s} />
          ))}
        </ul>
      )}

      {t.next && (
        <div className="ov-next">
          próximo: <Frags fragments={t.next.fragments} />
        </div>
      )}

      <GemHint advice={state.gemAdvice} />
      <TreeHint tree={state.tree} />

      {nextGems.length > 0 && (
        <div className="ov-gems">
          gemas em breve: {nextGems.map((g) => `${g.name} (${g.requiredLevel})`).join(", ")}
        </div>
      )}

      {interactive && (
        <div className="ov-controls">
          <span className="ov-drag">arraste</span>
          <button onClick={() => void window.hub.routePrev()}>◀ anterior</button>
          <button onClick={() => void window.hub.routeNext()}>próximo ▶</button>
          <button onClick={() => void window.hub.toggleOverlayInteractive()}>travar</button>
        </div>
      )}
    </div>
  );
}
