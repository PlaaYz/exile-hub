// Farm prices the official trade site fills in: items poe.ninja does not list (Reliquary Keys, some
// cards, beasts) and uniques whose poe.ninja price looks like a joke listing (hundreds of divines
// from a handful of listings). Like the usual boss calculators do.
import type { NamePrice } from "./ninja";
import { median } from "./pricecheck";
import type { ItemQueryKey, TradeClient } from "./trade";
import type { TradeStatus } from "../shared/types";

/** A poe.ninja price this high with this few listings is checked on the trade site. */
const kSuspectDivines = 50;
const kSuspectListings = 20;
/** Listings averaged (the cheapest ones the search returns). */
const kTradeListings = 10;

export interface TradeNamePrice {
  chaos: number;
  /** listings found on the trade site */
  listings: number;
}

/** True when the trade site should price this item: no poe.ninja price, or a suspicious one. */
export function needsTradePrice(p: NamePrice | undefined, chaosPerDivine: number | null): boolean {
  if (!p) return true;
  return isSuspect(p, chaosPerDivine);
}

export function isSuspect(p: NamePrice, chaosPerDivine: number | null): boolean {
  if (!chaosPerDivine) return false;
  return p.chaos >= kSuspectDivines * chaosPerDivine && (p.listings ?? 0) < kSuspectListings;
}

/**
 * The item's price on the trade site, instant buyout first, then sellers online; median of the
 * cheapest listings, in chaos. `key` (from the trade site's item list) says whether it is a unique
 * (name + base) or an item type, so one search usually does; without it, name then type is tried.
 */
export async function tradePriceByName(
  trade: TradeClient,
  league: string,
  name: string,
  rates: Map<string, number> | null,
  key?: ItemQueryKey | null,
): Promise<TradeNamePrice | null> {
  const statuses: TradeStatus[] = ["securable", "online"];
  const queries: ({ name: string } | { type: string })[] = key ? [key] : [{ name }, { type: name }];
  for (const q of queries) {
    for (const status of statuses) {
      let res;
      try {
        res = await trade.search(league, { query: { status: { option: status }, ...q }, sort: { price: "asc" } });
      } catch (e) {
        if (/Unknown item (name|type)/i.test((e as Error).message)) break; // try it as the other kind
        throw e;
      }
      const chaos = res.listings
        .slice(0, kTradeListings)
        .map((l) => (l.currency === "chaos" ? l.amount : rates?.get(l.currency) !== undefined ? l.amount * rates.get(l.currency)! : null))
        .filter((c): c is number => c !== null);
      const m = median(chaos);
      if (m !== null) return { chaos: Math.round(m * 10) / 10, listings: res.total };
      if (res.total > 0) return null; // listed, but in currencies we cannot convert
    }
  }
  return null;
}
