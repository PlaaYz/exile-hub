import { tr } from "../shared/i18n";
import { fmtMs, useHubState } from "./hooks";
import { PriceSummary, TierSummary, itemTitle } from "./PriceView";
import { Frags, StepView } from "./StepView";
import { MapHint } from "./MapsView";

const kOverlayMaxSteps = 9;
const kPriceCardMs = 25_000; // how long a price stays on the overlay after Ctrl+C

export function OverlayApp() {
  const hubState = useHubState();
  if (!hubState) return null;
  const state = hubState;
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
      {state.endgame ? endgameView() : campaignView()}

      {interactive && (
        <div className="ov-controls">
          <span className="ov-drag">{tr("arraste", "drag")}</span>
          {!state.endgame && <button onClick={() => void window.hub.routePrev()}>◀ {tr("anterior", "previous")}</button>}
          {!state.endgame && <button onClick={() => void window.hub.routeNext()}>{tr("próximo", "next")} ▶</button>}
          <button onClick={() => void window.hub.toggleOverlayInteractive()}>{tr("travar", "lock")}</button>
        </div>
      )}
    </div>
  );

  function endgameView() {
    // inside a map the map line above already says where you are
    const inMap = !!state.maps.current?.inside;
    return (
      <>
        {!inMap && (
          <div className="ov-head">
            <span className="ov-area">{state.areaName ?? tr("aguardando uma zona…", "waiting for a zone…")}</span>
            <span className="ov-meta">
              {state.characterName ?? "endgame"}
              {state.characterLevel !== null ? ` · ${tr("nível", "level")} ${state.characterLevel}` : ""}
            </span>
          </div>
        )}
        {state.logStatus !== "watching" && <div className="ov-warn">{tr("Client.txt não conectado — abra o painel", "Client.txt not connected — open the dashboard")}</div>}
      </>
    );
  }

  function campaignView() {
    return (
      <>
      <div className="ov-head">
        <span className="ov-area">{state.areaName ?? "aguardando uma zona…"}</span>
        <span className="ov-meta">
          {tr("Ato", "Act")} {t.act || "–"} · {fmtMs(timers.actMs)}
          {characterLevel !== null ? ` · ${tr("nível", "level")} ${characterLevel}` : ""}
        </span>
      </div>

      {state.logStatus !== "watching" && <div className="ov-warn">Client.txt não conectado — abra o painel</div>}
      {t.offRoute && <div className="ov-warn">{tr("fora da rota — sincronize no painel", "off route — sync in the dashboard")}</div>}

      {t.done ? (
        <div className="ov-done">{tr("Rota da campanha concluída", "Campaign route complete")}</div>
      ) : (
        <ul className="steps">
          {t.block.slice(0, kOverlayMaxSteps).map((s) => (
            <StepView key={s.id} step={s} />
          ))}
        </ul>
      )}

      {t.next && (
        <div className="ov-next">
          {tr("próximo:", "next:")} <Frags fragments={t.next.fragments} />
        </div>
      )}


      {nextGems.length > 0 && (
        <div className="ov-gems">
          {tr("gemas em breve:", "gems soon:")} {nextGems.map((g) => `${g.name} (${g.requiredLevel})`).join(", ")}
        </div>
      )}
      </>
    );
  }
}
