// The passive tree drawn from GGG's data: the build's nodes, what the character already has and the
// numbered path of what to take next (like Path of Building). "mini" fits the build, "full" is a
// zoomable/draggable view.
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { tr } from "../shared/i18n";
import type { AppState, TreeLayout } from "../shared/types";

type Progress = NonNullable<NonNullable<AppState["tree"]>["progress"]>;
type Mode = "mini" | "full";

// the geometry is fetched once per window (~3000 nodes) and kept
let layoutCache: TreeLayout | null = null;
let layoutLoading: Promise<TreeLayout | null> | null = null;

export function useTreeLayout(): TreeLayout | null {
  const [layout, setLayout] = useState<TreeLayout | null>(layoutCache);
  useEffect(() => {
    if (layout) return;
    let alive = true;
    const tryLoad = () => {
      layoutLoading ??= window.hub.getTreeLayout().finally(() => (layoutLoading = null));
      void layoutLoading.then((l) => {
        if (l) layoutCache = l;
        if (alive && l) setLayout(l);
      });
    };
    tryLoad();
    const t = setInterval(() => !layoutCache && tryLoad(), 5000); // tree data may still be downloading
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [layout]);
  return layout;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function bbox(points: { x: number; y: number }[], margin: number): Box | null {
  if (!points.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + 2 * margin, h: y1 - y0 + 2 * margin };
}

const RADIUS = [26, 42, 60, 70]; // small, notable, keystone, start (tree units)

export function TreeMap({ progress, mode, height, layout: given }: { progress: Progress; mode: Mode; height?: number; layout?: TreeLayout }) {
  const fetched = useTreeLayout();
  const layout = given ?? fetched;
  const geo = useMemo(() => {
    if (!layout) return null;
    const pos = new Map<number, { x: number; y: number; k: number }>();
    for (const [id, x, y, k] of layout.nodes) pos.set(id, { x, y, k });
    return { pos };
  }, [layout]);

  const build = useMemo(() => new Set(progress.buildIds), [progress.buildIds]);
  const have = useMemo(() => new Set(progress.haveIds), [progress.haveIds]);
  const next = progress.nextPath;
  const nextIndex = useMemo(() => new Map(next.map((id, i) => [id, i])), [next]);

  // the area to show first: the whole build and its class start
  const focus = useMemo<Box | null>(() => {
    if (!geo) return null;
    const ids = [...progress.buildIds, ...(progress.startId !== null ? [progress.startId] : [])];
    return bbox(ids.map((id) => geo.pos.get(id)).filter((p): p is { x: number; y: number; k: number } => !!p), 400);
  }, [geo, progress.buildIds, progress.startId]);

  const [view, setView] = useState<Box | null>(focus);
  useEffect(() => setView(focus), [focus?.x, focus?.y, focus?.w, focus?.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const drag = useRef<{ x: number; y: number; box: Box } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!layout || !geo || !view) {
    return <div className="muted small">{layout ? "" : tr("Carregando o mapa da árvore…", "Loading the tree map…")}</div>;
  }


  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    if (mode !== "full" || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const k = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const w = Math.min(30000, Math.max(800, view.w * k));
    const h = (view.h * w) / view.w;
    setView({ x: view.x + (view.w - w) * fx, y: view.y + (view.h - h) * fy, w, h });
  };
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (mode !== "full") return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, box: view };
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const sx = d.box.w / r.width;
    setView({ ...d.box, x: d.box.x - (e.clientX - d.x) * sx, y: d.box.y - (e.clientY - d.y) * sx });
  };

  const onPath = (id: number) => nextIndex.has(id) || have.has(id) || id === progress.startId;
  const edgeClass = (a: number, b: number) => {
    if ((nextIndex.has(a) || nextIndex.has(b)) && onPath(a) && onPath(b)) return "t-edge next";
    if (have.has(a) && have.has(b)) return "t-edge have";
    if (build.has(a) && build.has(b)) return "t-edge build";
    return "t-edge";
  };
  const nodeClass = (id: number) =>
    nextIndex.has(id) ? "t-node next" : have.has(id) ? "t-node have" : build.has(id) ? "t-node build" : "t-node";

  return (
    <svg
      ref={svgRef}
      className={`tree-map tree-${mode}`}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={height ? { height } : undefined}
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
    >
      <g>
        {layout.edges.map(([a, b, r, sweep]) => {
          const pa = geo.pos.get(a)!;
          const pb = geo.pos.get(b)!;
          if (r) {
            return <path key={`${a}-${b}`} className={edgeClass(a, b)} d={`M${pa.x} ${pa.y}A${r} ${r} 0 0 ${sweep} ${pb.x} ${pb.y}`} />;
          }
          return <line key={`${a}-${b}`} className={edgeClass(a, b)} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} />;
        })}
      </g>
      <g>
        {layout.nodes.map(([id, x, y, k]) => {
          return (
            <circle key={id} className={`${nodeClass(id)} k${k}`} cx={x} cy={y} r={RADIUS[k]}>
              <title>
                {`${layout.names[id] ?? ""}${
                  nextIndex.has(id) ? ` — ${tr("passo", "step")} ${nextIndex.get(id)! + 1}` : have.has(id) ? tr(" — já tem", " — allocated") : build.has(id) ? tr(" — do build", " — in the build") : ""
                }`}
              </title>
            </circle>
          );
        })}
      </g>
      <g>
        {next.slice(0, 15).map((id, i) => {
          const p = geo.pos.get(id);
          if (!p) return null;
          return (
            <text key={id} className="t-step" x={p.x} y={p.y} dy={mode === "mini" ? 40 : 30}>
              {i + 1}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

/** Full-screen view with zoom (wheel) and drag. */
export function TreeMapModal({ progress, onClose }: { progress: Progress; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="tree-modal" onClick={onClose}>
      <div className="tree-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <b>{tr("Árvore passiva", "Passive tree")}</b>
          <span className="muted small">
            {tr("roda do mouse = zoom · arrastar = mover", "mouse wheel = zoom · drag = move")} · <span className="t-legend build">●</span>{" "}
            {tr("do build", "in the build")} · <span className="t-legend next">●</span> {tr("primeiros pontos (na ordem)", "first points (in order)")}
          </span>
          <button onClick={onClose}>{tr("fechar (Esc)", "close (Esc)")}</button>
        </div>
        <TreeMap progress={progress} mode="full" />
      </div>
    </div>
  );
}
