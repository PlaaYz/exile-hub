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
    // Clicking the game (or anywhere else) deactivates the window: done. The page's own "blur" can't
    // be used: dragging the title bar starts Windows' move loop, which takes the focus from the
    // webview (not from the window) and closed the popup on every drag. The window's activation
    // stays during a drag; a short grace period covers a focus flicker.
    let unlisten: (() => void) | null = null;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    if ("__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
        const un = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (pending) clearTimeout(pending);
          pending = focused ? null : setTimeout(close, 150);
        });
        if (disposed) un();
        else unlisten = un;
      });
    } else {
      window.addEventListener("blur", close);
    }
    return () => {
      disposed = true;
      if (pending) clearTimeout(pending);
      unlisten?.();
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
