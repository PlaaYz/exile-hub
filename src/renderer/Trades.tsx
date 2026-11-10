// Buy request cards (someone whispered the trade site's "Hi, I would like to buy your ..."): what,
// for how much, where it is in your stash, and buttons that type the usual chat commands. The window
// never takes the keyboard from the game, so the commands go straight into the game's chat.
import { useEffect, useState } from "react";
import type { TradeAction, TradeCard } from "../shared/types";
import { tr } from "../shared/i18n";
import { useHubState } from "./hooks";

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min`;
}

export function Card({ t, now }: { t: TradeCard; now: number }) {
  const o = t.offer;
  const act = (a: TradeAction) => void window.hub.tradeAction(t.id, a);
  const price = o.bulk
    ? `${o.bulk.count}× ${tr("por", "for")} ${o.bulk.pay.amount} ${o.bulk.pay.currency}`
    : o.price
      ? `${o.price.amount} ${o.price.currency}`
      : tr("sem preço", "no price");
  return (
    <div className={`trade-card${t.arrived ? " arrived" : ""}`}>
      <div className="trade-head" data-tauri-drag-region>
        <b>{t.from}</b>
        {t.arrived && <span className="trade-badge">{tr("chegou", "arrived")}</span>}
        <span className="muted small">{tr(`há ${ago(t.at, now)}`, `${ago(t.at, now)} ago`)}</span>
        <button className="trade-x" title={tr("Fechar", "Close")} onClick={() => act("dismiss")}>
          ✕
        </button>
      </div>
      <div className="trade-item" title={o.item}>
        {o.item}
      </div>
      <div className="trade-meta">
        <span className="trade-price">{price}</span>
        {o.stash && (
          <span className="muted small">
            {" "}
            · {tr("aba", "tab")} "{o.stash.tab}" ({tr("esq.", "left")} {o.stash.left}, {tr("topo", "top")} {o.stash.top})
          </span>
        )}
        {o.note && <span className="muted small" title={o.note}> · "{o.note}"</span>}
      </div>
      <div className="trade-buttons">
        <button onClick={() => act("invite")}>{tr("Convidar", "Invite")}</button>
        <button onClick={() => act("trade")}>Trade</button>
        <button onClick={() => act("thanks")}>{tr("Obrigado", "Thanks")}</button>
        <button onClick={() => act("sold")}>{tr("Vendido", "Sold")}</button>
        <button onClick={() => act("kick")}>{tr("Expulsar", "Kick")}</button>
      </div>
    </div>
  );
}

export function TradesApp() {
  const state = useHubState();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!state) return null;
  return (
    <div className="trades">
      {state.trades.slice(0, 4).map((t) => (
        <Card key={t.id} t={t} now={now} />
      ))}
    </div>
  );
}
