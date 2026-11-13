// Equipamento tab: what the player wears, laid out like the game's character screen (item art from
// poe.ninja, sockets and links drawn from the copied text), and the last item copied with Ctrl+C
// compared with it. Items come from "register my equipment" (Ctrl+C on each worn item) or the PoB build.
import { useState } from "react";
import { tr } from "../shared/i18n";
import type { AppState, GearItemView } from "../shared/types";
import { CompareBlock, slotLabel } from "./PriceView";

/** Grid cells of each slot: [column, row, width, height] on an 8 x 6 grid, like the game's screen. */
const SLOTS: Record<string, [number, number, number, number]> = {
  "Weapon 1": [1, 1, 2, 4],
  Helmet: [4, 1, 2, 2],
  "Weapon 2": [7, 1, 2, 4],
  "Body Armour": [4, 3, 2, 3],
  "Ring 1": [3, 4, 1, 1],
  Amulet: [6, 3, 1, 1],
  "Ring 2": [6, 4, 1, 1],
  Gloves: [2, 5, 2, 2],
  Belt: [4, 6, 2, 1],
  Boots: [6, 5, 2, 2],
};

/** Gem colour of each socket: [light centre, dark rim]. A = abyss, D = Delve resonator. */
const SOCKET_COLOR: Record<string, [string, string]> = {
  R: ["#ff6a55", "#7a1410"],
  G: ["#8be05a", "#245b12"],
  B: ["#6fa4ff", "#13306e"],
  W: ["#ffffff", "#8a8a8a"],
  A: ["#3a3a3a", "#0e0e0e"],
  D: ["#d8bf78", "#5e4a1c"],
};

/** Gradients shared by every socket drawing (the same ids in each svg: identical, so whichever is found works). */
function SocketDefs() {
  return (
    <defs>
      {Object.entries(SOCKET_COLOR).map(([c, [light, dark]]) => (
        <radialGradient key={c} id={`sk-${c}`} cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor={light} />
          <stop offset="100%" stopColor={dark} />
        </radialGradient>
      ))}
      <linearGradient id="sk-link" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#5b3f1c" />
        <stop offset="50%" stopColor="#e2b765" />
        <stop offset="100%" stopColor="#5b3f1c" />
      </linearGradient>
      <linearGradient id="sk-link-h" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#5b3f1c" />
        <stop offset="50%" stopColor="#e2b765" />
        <stop offset="100%" stopColor="#5b3f1c" />
      </linearGradient>
    </defs>
  );
}

/**
 * Sockets the way the game draws them: one per inventory cell, two columns snaking down (one column on
 * narrow items), centred on the item; a socket is a dark metal ring around the gem colour, a link a short
 * bronze bar between two sockets.
 */
function Sockets({ sockets, w, h }: { sockets: string; w: number; h: number }) {
  const groups = sockets.trim().split(/\s+/).filter(Boolean).map((g) => g.split("-"));
  const all = groups.flat();
  if (!all.length) return null;
  const cols = Math.min(w, 2);
  const rows = Math.ceil(all.length / cols);
  const cell = 50;
  const top = ((h - rows) / 2) * cell;
  const left = ((w - Math.min(cols, all.length)) / 2) * cell;
  const pos = (i: number) => {
    const r = Math.floor(i / cols);
    const c = cols === 1 ? 0 : r % 2 === 0 ? i % 2 : 1 - (i % 2);
    return { x: left + c * cell + cell / 2, y: top + r * cell + cell / 2 };
  };
  const R = 15; // socket radius in a 50-unit cell
  const links: { a: number; b: number }[] = [];
  let i = 0;
  for (const g of groups) {
    for (let k = 1; k < g.length; k++) links.push({ a: i + k - 1, b: i + k });
    i += g.length;
  }
  return (
    <svg className="sockets" viewBox={`0 0 ${w * cell} ${h * cell}`} preserveAspectRatio="xMidYMid meet">
      <SocketDefs />
      {links.map(({ a, b }) => {
        const p = pos(a);
        const q = pos(b);
        const horizontal = p.y === q.y;
        const len = Math.abs(horizontal ? q.x - p.x : q.y - p.y) - 2 * R + 8;
        const x = (p.x + q.x) / 2;
        const y = (p.y + q.y) / 2;
        return horizontal ? (
          <rect key={`${a}-${b}`} className="link" x={x - len / 2} y={y - 5} width={len} height={10} rx={2} fill="url(#sk-link-h)" />
        ) : (
          <rect key={`${a}-${b}`} className="link" x={x - 5} y={y - len / 2} width={10} height={len} rx={2} fill="url(#sk-link)" />
        );
      })}
      {all.map((c, k) => {
        const p = pos(k);
        return (
          <g key={k}>
            <circle className="ring" cx={p.x} cy={p.y} r={R} />
            <circle cx={p.x} cy={p.y} r={R - 5} fill={`url(#sk-${SOCKET_COLOR[c] ? c : "A"})`} />
          </g>
        );
      })}
    </svg>
  );
}

export const linksOf = (sockets: string) => Math.max(0, ...sockets.trim().split(/\s+/).filter(Boolean).map((g) => g.split("-").length));

function ItemDetail({ g }: { g: GearItemView }) {
  const links = linksOf(g.sockets);
  return (
    <div className="gear-detail">
      <div className={`gear-name ${g.rarity.toLowerCase()}`}>
        {g.name}
        {g.name !== g.baseType && <span className="muted"> · {g.baseType}</span>}
      </div>
      <div className="muted small">
        {g.slot ? slotLabel(g.slot) : ""}
        {g.sockets && ` · sockets ${g.sockets}${links > 1 ? ` (${links}L)` : ""}`}
        {" · "}
        {g.fromGame ? tr("registrado no jogo", "registered in game") : tr("do build do PoB", "from the PoB build")}
      </div>
      <ul className="gear-lines">
        {g.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {g.fromGame && g.slot && (
        <button className="small-btn" onClick={() => void window.hub.removeGear(g.slot)}>
          {tr("Remover este item", "Remove this item")}
        </button>
      )}
    </div>
  );
}

export function GearPanelBody({ state }: { state: AppState }) {
  const gear = state.gear;
  const [sel, setSel] = useState<string | null>(null);
  const bySlot = new Map(gear.items.map((g) => [g.slot, g]));
  const registered = gear.items.filter((g) => g.fromGame).length;
  const on = gear.register;
  const selected = sel ? bySlot.get(sel) : undefined;
  const c = gear.copied;
  const canCompare = !!state.build || registered > 0;
  return (
    <>
      <div className={`gear${on ? " on" : ""}`}>
        <div className="row" style={{ margin: 0 }}>
          <span className="muted small" style={{ flex: 1 }}>
            {tr(`${registered} de 10 registrados no jogo`, `${registered} of 10 registered in game`)}
            {gear.items.length > registered ? tr(" · o resto vem do build do PoB", " · the rest from the PoB build") : ""}
          </span>
          <button className={on ? "primary" : ""} onClick={() => void window.hub.setGearRegister(!on)}>
            {on ? tr("Terminar registro", "Finish registering") : registered ? tr("Registrar de novo", "Register again") : tr("Registrar meu equipamento", "Register my equipment")}
          </button>
        </div>
        {on && (
          <p className="small" style={{ margin: "6px 0" }}>
            {tr(
              "No jogo: abra a tela do personagem (I) e dê Ctrl+C em cada item equipado. O primeiro anel vira Anel 1 e o segundo Anel 2; a segunda arma de uma mão vira a segunda mão.",
              "In game: open the character screen (I) and press Ctrl+C on each equipped item. The first ring is Ring 1 and the second Ring 2; a second one-handed weapon goes to the off hand.",
            )}
          </p>
        )}
      </div>
      <div className="paperdoll">
        {Object.entries(SLOTS).map(([slot, [x, y, w, h]]) => {
          const g = bySlot.get(slot);
          return (
            <button
              key={slot}
              className={`doll-slot${g ? ` ${g.rarity.toLowerCase()}` : " empty"}${sel === slot ? " sel" : ""}${g && !g.fromGame ? " pob" : ""}`}
              style={{ gridColumn: `${x} / span ${w}`, gridRow: `${y} / span ${h}` }}
              title={g ? `${g.name}${g.name !== g.baseType ? ` (${g.baseType})` : ""}` : slotLabel(slot)}
              onClick={() => setSel(sel === slot ? null : slot)}
              disabled={!g}
            >
              {g?.icon ? <img src={g.icon} alt="" draggable={false} /> : <span className="doll-label">{g ? g.baseType : slotLabel(slot)}</span>}
              {g && <Sockets sockets={g.sockets} w={w} h={h} />}
            </button>
          );
        })}
      </div>
      {selected ? (
        <ItemDetail g={selected} />
      ) : (
        gear.items.length > 0 && <p className="muted small">{tr("Clique num item para ver os mods dele.", "Click an item to see its mods.")}</p>
      )}
      <h3>{tr("Item copiado (Ctrl+C)", "Copied item (Ctrl+C)")}</h3>
      {c ? (
        <>
          <div className="gear-copied">
            {c.item.icon && <img src={c.item.icon} alt="" />}
            <span className={`gear-name ${c.item.rarity.toLowerCase()}`}>
              {c.item.name}
              {c.item.name !== c.item.baseType && <span className="muted"> · {c.item.baseType}</span>}
            </span>
          </div>
          <CompareBlock compare={c.compare} rarity={c.item.rarity} hasBuild={canCompare} />
          {!c.compare && canCompare && (
            <p className="muted small">{tr("Nada registrado nesse slot para comparar.", "Nothing registered in that slot to compare with.")}</p>
          )}
        </>
      ) : (
        <p className="muted small">
          {tr(
            "No jogo, passe o mouse sobre um item e aperte Ctrl+C: ele aparece aqui comparado com o que você usa. Para o preço, use Ctrl+D.",
            "In game, hover an item and press Ctrl+C: it shows here against what you wear. For its price, press Ctrl+D.",
          )}
        </p>
      )}
    </>
  );
}
