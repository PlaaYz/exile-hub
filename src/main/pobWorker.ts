// Runs inside an Electron utilityProcess so Path of Building's engine (2 s boot, ~1-3 s per
// ranking) never blocks the app.
//   { type: "init", pobDir, wrapperPath, driverPath }  -> { type: "ready" } | { type: "error", error }
//   { type: "suggest", id, req }                        -> { type: "result", id, json }
import { createPobLua, type PobLua } from "./luaHost";

interface ParentPort {
  on(event: "message", cb: (e: { data: unknown }) => void): void;
  postMessage(msg: unknown): void;
}
const port = (process as unknown as { parentPort: ParentPort }).parentPort;
let engine: PobLua | null = null;

port.on("message", (e) => {
  const msg = e.data as { type: string; id?: number; req?: unknown; pobDir?: string; wrapperPath?: string; driverPath?: string };
  try {
    if (msg.type === "init") {
      engine = createPobLua(msg.pobDir!, msg.wrapperPath!, msg.driverPath!);
      port.postMessage({ type: "ready" });
    } else if (msg.type === "suggest") {
      if (!engine) throw new Error("engine not initialised");
      port.postMessage({ type: "result", id: msg.id, json: engine.suggest(msg.req) });
    }
  } catch (err) {
    port.postMessage({ type: "error", id: msg.id, error: (err as Error).message });
  }
});
