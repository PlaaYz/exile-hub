import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DashboardApp } from "./Dashboard";
import { OverlayApp } from "./Overlay";

const mode = new URLSearchParams(window.location.search).get("mode");
document.body.classList.add(mode === "overlay" ? "mode-overlay" : "mode-dashboard");

async function boot(): Promise<void> {
  // on Tauri the app runs here (dashboard) instead of in a main process: start it first
  if ("__TAURI_INTERNALS__" in window) {
    const { installTauriHub } = await import("../tauri/boot");
    await installTauriHub(mode);
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>{mode === "overlay" ? <OverlayApp /> : <DashboardApp />}</StrictMode>,
  );
}

boot().catch((e: unknown) => {
  console.error("Exile Hub failed to start", e);
  document.getElementById("root")!.textContent = `Exile Hub não iniciou: ${e instanceof Error ? e.message : String(e)}`;
});
