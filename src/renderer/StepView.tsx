import type { Fragment, Step } from "../shared/types";
import { dirArrow } from "../shared/render";
import { routeTextPtBR } from "../shared/routePtBR";

function Frag({ f }: { f: Fragment }) {
  switch (f.kind) {
    case "text":
      return <>{routeTextPtBR(f.text)}</>;
    case "enter":
      return <span className="f f-enter">➞ {f.name}</span>;
    case "area":
      return <span className="f f-enter">{f.name}</span>;
    case "waypoint":
      return <span className="f f-wp">{f.name ? `Waypoint → ${f.name}` : "Waypoint"}</span>;
    case "waypoint_get":
      return <span className="f f-wp">o waypoint</span>;
    case "quest":
      return <span className="f f-quest">{f.name}</span>;
    case "label":
      return <span className={`f f-${f.style}`}>{f.text}</span>;
    case "reward_vendor":
      return (
        <span className="f f-vendor">
          {f.text}
          {f.cost ? ` (${f.cost})` : ""}
        </span>
      );
    case "logout":
      return <span className="f f-logout">logout</span>;
    case "trial":
      return <span className="f f-asc">trial da ascendência</span>;
    case "ascend":
      return <span className="f f-asc">Lab ({f.version})</span>;
    case "crafting":
      return <span className="f f-craft">receita de crafting</span>;
    case "dir":
      return <span className="f f-dir">{dirArrow(f.degrees)}</span>;
    case "portal":
      return <span className="f f-wp">{f.mode === "set" ? "abra um portal" : "use o portal"}</span>;
    case "copy":
      return <span className="f f-generic">{f.text}</span>;
  }
}

export function Frags({ fragments }: { fragments: Fragment[] }) {
  return (
    <>
      {fragments.map((f, i) => (
        <Frag key={i} f={f} />
      ))}
    </>
  );
}

export function StepView({ step, showSubs = true }: { step: Step; showSubs?: boolean }) {
  return (
    <li className="step">
      <div className="step-main">
        <Frags fragments={step.fragments} />
      </div>
      {showSubs &&
        step.subs.map((sub, i) => (
          <div className="step-sub" key={i}>
            <Frags fragments={sub} />
          </div>
        ))}
    </li>
  );
}
