import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DashboardApp } from "./Dashboard";
import { OverlayApp } from "./Overlay";

const mode = new URLSearchParams(window.location.search).get("mode");
document.body.classList.add(mode === "overlay" ? "mode-overlay" : "mode-dashboard");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{mode === "overlay" ? <OverlayApp /> : <DashboardApp />}</StrictMode>,
);
