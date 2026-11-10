import { useEffect, useState } from "react";
import { resolveLang, setLang } from "../shared/i18n";
import type { AppState } from "../shared/types";

export function useHubState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    let alive = true;
    // the language is set before the components render with the new state
    const take = (s: AppState) => {
      if (!alive) return;
      setLang(resolveLang(s.config.language));
      setState(s);
    };
    void window.hub.getState().then(take);
    const off = window.hub.onState(take);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

export function fmtMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
