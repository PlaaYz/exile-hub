// Buy requests the official trade site puts in a whisper ("Hi, I would like to buy your ... listed
// for ..."), so the app can show them as cards with invite / trade / thanks buttons. Only these
// templated messages are read; anything else a player whispers stays private (not even parsed).

export interface TradeOffer {
  /** item as the buyer's whisper names it ("Tabula Rasa Simple Robe", "level 20 0% Cyclone") */
  item: string;
  /** the listed price, null for "unpriced" listings */
  price: { amount: number; currency: string } | null;
  league: string;
  /** where the item is in the seller's stash, when the whisper says it */
  stash: { tab: string; left: number; top: number } | null;
  /** bulk exchange: how many of the item for how much */
  bulk: { count: number; pay: { amount: number; currency: string } } | null;
  /** whatever the buyer typed after the template */
  note: string | null;
}

const num = (s: string) => Number(s.replace(/,/g, ""));

// Hi, I would like to buy your X listed for 10 chaos in League (stash tab "Tab"; position: left 1, top 2) note
const SINGLE_STASH =
  /^Hi, I would like to buy your (.+?)(?: listed for ([\d.,]+) (.+?))? in (.+?) \(stash tab "(.*)"; position: left (\d+), top (\d+)\)(?:\s+(.*))?$/;
// without the stash part the league runs to the end (league names have spaces: "Hardcore Allflame")
const SINGLE = /^Hi, I would like to buy your (.+?)(?: listed for ([\d.,]+) (.+?))? in (.+)$/;
// Hi, I'd like to buy your 10 Divine Orb for my 4500 Chaos Orb in League. note
const BULK = /^Hi, I'd like to buy your ([\d.,]+) (.+?) for my ([\d.,]+) (.+?) in (.+?)\.(?:\s+(.*))?$/;

export function parseTradeWhisper(message: string): TradeOffer | null {
  const text = message.trim();
  let m = BULK.exec(text);
  if (m) {
    return {
      item: m[2],
      price: null,
      league: m[5],
      stash: null,
      bulk: { count: num(m[1]), pay: { amount: num(m[3]), currency: m[4] } },
      note: m[6]?.trim() || null,
    };
  }
  m = SINGLE_STASH.exec(text) ?? SINGLE.exec(text);
  if (!m) return null;
  return {
    item: m[1],
    price: m[2] ? { amount: num(m[2]), currency: m[3] } : null,
    league: m[4].replace(/\.$/, ""),
    stash: m[5] !== undefined ? { tab: m[5], left: Number(m[6]), top: Number(m[7]) } : null,
    bulk: null,
    note: m[8]?.trim() || null,
  };
}
