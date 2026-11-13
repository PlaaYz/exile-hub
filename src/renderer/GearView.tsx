// Equipamento tab: what the player wears, laid out like the game's character screen (item art from
// poe.ninja), and the last item copied with Ctrl+C
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

/** Two-handed weapons: the game greys their picture into the off-hand slot (a bow's quiver goes there instead). */
const TWO_HANDED = /^(Two Hand|Staves|Warstaves|Bows|Fishing Rods)/;

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
  const canCompare = registered > 0;
  // a two-handed weapon leaves no off hand to register (a bow's quiver still counts when registered)
  const twoHanded = TWO_HANDED.test(bySlot.get("Weapon 1")?.itemClass ?? "") && !bySlot.has("Weapon 2");
  const slotsToFill = twoHanded ? 9 : 10;
  return (
    <>
      <div className={`gear${on ? " on" : ""}`}>
        <div className="row" style={{ margin: 0 }}>
          <span className="muted small" style={{ flex: 1 }}>
            {tr(`${registered} de ${slotsToFill} registrados no jogo`, `${registered} of ${slotsToFill} registered in game`)}
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
          const main = bySlot.get("Weapon 1");
          if (slot === "Weapon 2" && !g && main && TWO_HANDED.test(main.itemClass)) {
            return (
              <div key={slot} className="doll-slot two-hand" style={{ gridColumn: `${x} / span ${w}`, gridRow: `${y} / span ${h}` }} title={main.name}>
                {main.icon && <img src={main.icon} alt="" draggable={false} />}
              </div>
            );
          }
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
