# Price check no estilo do APT — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ctrl+D shows the item's mods right under its name; toggling or editing one re-runs the trade search by itself and the price shows right below.

**Architecture:** The core `PriceChecker` makes the newest `research` win over older answers still in flight. The renderer's shared `PricePanelBody` (popup and Price tab) is reordered (editor first, then summary and listings) and `SearchEditor` schedules `priceResearch` 1 s after the last change instead of a "Buscar" button.

**Tech Stack:** TypeScript, React, vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-price-check-apt-design.md`

## Global Constraints

- Debounce: 1000 ms after the last change; a change inside the wait restarts it.
- GGG search limits (600 per 6 h, 5 per 10 s): a burst of quick changes = ONE search.
- Same component for the Ctrl+D popup and the Price tab (`PricePanelBody`).
- Items with `tradeStatus === "n/a"` (bulk currency) keep today's behaviour.
- UI strings stay `tr("pt", "en")` pairs.

## Review Focus

- Changing filters while a search is still running: the panel must end with the results of the LAST change, never an older one (Task 1 test).
- A new Ctrl+D item arriving while a debounce timer is pending: the pending search must not fire against the new item (Task 2: timer cleared when `p.seq` changes).
- The state is re-broadcast every second as a new object: re-renders must not reset the user's edits nor re-trigger a search (Task 2 keeps the existing `key` reset logic; the timer starts only from user edits).
- Rare/magic: tiers block and poe.ninja reference folded below listings; unique/gem/currency: ninja price stays at the top (Task 2, checked in the test app).
- "Mais resultados" after an automatic search uses the newest search's ids (follows from Task 1: `cur.queryId/rest` set only by the newest answer).

---

### Task 1: The newest search wins

**Files:**
- Modify: `src/core/pricecheck.ts` (`research`, `runTrade`, the `current` record)
- Test: `test/price.test.ts`

**Interfaces:**
- Produces: unchanged public API (`research(patch: PriceSearchPatch): void`); internally a per-item search counter so `runTrade` / `runSimilar` patch the view (and set `queryId` / `rest`) only when their search is still the newest.

- [ ] **Step 1: Write the failing test** `"a newer research wins over an older one still running"` in the `PriceChecker` describe: use a trade fetch whose FIRST POST resolves only after the second one (hold its promise until the second POST arrived), run `check(ring)`, settle, call `research` twice (first with only `explicit.life` enabled, then with only `explicit.cold` enabled), settle; expect `pc.view!.tradeStatus` to be `"done"` and the final `trade` / `queryId` to come from the second search (e.g. the fake returns `total: 7` for bodies whose stats include `explicit.cold`, `total: 3` otherwise; expect `pc.view!.trade!.total` toBe `7`).
- [ ] **Step 2: Run it:** `npx vitest run test/price.test.ts` — Expected: FAIL (total 3).
- [ ] **Step 3: Implement:** add `searchGen: number` to the current-item record, bump it in `research` (and at the first search), pass it into `runTrade` / `runSimilar`, and skip `patch` / `queryId` / `rest` when it is no longer the current `searchGen`.
- [ ] **Step 4: Run:** `npx vitest run test/price.test.ts` and `npm run typecheck` — Expected: all PASS.
- [ ] **Step 5: Commit:** `git commit -m "Price check: the newest search wins over older answers still in flight"`

### Task 2: Mods first, automatic search

**Files:**
- Modify: `src/renderer/PriceView.tsx` (`PricePanelBody`, `SearchEditor`)
- Modify: `src/renderer/styles.css` (only if the folded block needs a style)

**Interfaces:**
- Consumes: `window.hub.priceResearch(patch: PriceSearchPatch)` (unchanged).

- [ ] **Step 1: Reorder `PricePanelBody`:** title, the short line (rarity · class · ilvl · league · div rate), then `<SearchEditor>`, then `<PriceSummary>`, `<SimilarBlock>`, `<BulkTable>`, the listings table, the "Abrir no site do trade" / "Mais resultados" row, then — for `Rare`/`Magic` — `<CalcLine>`, `<ModTiers>` and the poe.ninja reference line inside `<details className="price-more"><summary>{tr("Detalhes do item", "Item details")}</summary>…</details>`; for other rarities keep them right after the short line as today. `<RecentChecks>` last.
- [ ] **Step 2: Automatic search in `SearchEditor`:** remove the "Buscar" button; every user edit (checkbox, min, max, status, base type, corrupted, influences, range rows) updates local state and (re)starts a `setTimeout` of `kAutoSearchMs = 1000` that calls `window.hub.priceResearch` with the latest local mods/filters (keep them in a ref so the timer sends the newest values). Clear the timer on unmount and when `p.seq` changes. The existing `key`-based reset from the broadcast state must not start a timer.
- [ ] **Step 3: Run:** `npm run typecheck` and `npm test` — Expected: PASS (no renderer unit tests exist for this panel).
- [ ] **Step 4: Check in the debug build** (`npx tauri build --debug --no-bundle`, run with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9334`): open the price popup with a recent check, toggle three mods quickly, confirm through the diagnostics / `getState()` that ONE search ran and the listings below the mods changed; confirm a unique still shows the poe.ninja price at the top. Close the debug build and reopen the installed app afterwards.
- [ ] **Step 5: Commit:** `git commit -m "Price check: mods first under the item name, search runs by itself 1 s after a change"`
