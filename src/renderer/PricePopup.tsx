// The price popup over the game (price key, e.g. Ctrl+D): the same price check as the dashboard's
// panel, next to the item. Esc, the close button or clicking back into the game closes it.
import { useEffect } from "react";
import { useHubState } from "./hooks";
import { PricePanelBody } from "./PriceView";

export function PricePopupApp() {
  const state = useHubState();
  useEffect(() => {
    const close = () => void window.hub.closePricePopup();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    // clicking the game (or anywhere else) takes the focus away: done
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, []);
  if (!state) return null;
  return (
    <div className="price-popup">
      <div className="price-popup-bar" data-tauri-drag-region>
        <span className="muted small" data-tauri-drag-region>
          Exile Hub · preço
        </span>
        <button className="small" onClick={() => void window.hub.closePricePopup()} title="Fechar (Esc)">
          ✕
        </button>
      </div>
      <div className="price-popup-body">
        <PricePanelBody p={state.price} />
      </div>
    </div>
  );
}
