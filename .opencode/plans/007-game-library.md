# Plan — Feature 007 milestone 2: Game Library

## Objective

Turn `/games` into a scalable Game Library (browse / search / filter /
select / inspect / delete), built on the canonical model in
`specs/domain/game-library.md`. Future features (008 bulk+review, 011
puzzles-from-game, 014 per-game insights) plug into the row-actions and
insights seams without redesigning the page.

## Scope

- Desktop table + deliberate mobile card list.
- Search over player names and external game id.
- Filters: time frame (all/today/7d/30d/3m/6m/year/custom), time control
  (all + ADR-013 categories), side (all/white/black), platform
  (all/Lichess/Chess.com).
- Local-timezone calendar-day date boundaries (inclusive).
- Single canonical filter state, URL-encoded (useSearchParams), search +
  filters ANDed, individually clearable + clear-all.
- Selection: Set<GameId>, select-all = current filtered result set,
  **cleared on any filter/search change or deletion**.
- Deletion: single + multi, confirmation dialog, cascade-ready
  `deleteGames(ids)` (v3 schema unchanged).
- Disabled bulk **Analyze** placeholder (no faked function).
- States: no games / no matches / loading / error / import-in-progress.
- DB pushdown (GameQuery indexed equality + local-day bounds) + bounded
  in-memory name search + windowed rows (Show-more).
- Deterministic fixtures + full domain/component/e2e test matrix.

## Out of scope / deferred

- Sorting beyond newest-first (comparator registry only).
- Opening/ECO search (not stored).
- Multi-select filter chips.
- Live-analysis/review/puzzles row actions and insights columns
  (register later by Features 006/008/011/014).
- True virtualization/pagination beyond windowing (schema-v4 note).
- Multi-delete dependent tables (no dependents exist; path ready).

## Domain changes (`src/domain/gameLibrary/`)

| File | Purpose |
|---|---|
| `filters.ts` | `GameLibraryFilters` (single canonical state), defaults, equality, URL codec (`toQuery`/`fromQuery`), clear helpers. Pure. |
| `timeframe.ts` | Time-frame presets + `resolveTimeFrame(frame, nowMs)` → local `{fromMs,toMs}` inclusive, custom validation. Pure, `now`-injected. |
| `search.ts` | `matchesSearch(summaryLike, query)`: case-insensitive substring over White name, Black name, externalId. |
| `predicates.ts` | `matchesLibraryFilters(summaryLike, filters, resolvedWindow)` (AND of platform/timeControl/side/date + search). |
| `sort.ts` | Default newest-first comparator + registry type for future keys. |
| `selection.ts` | `GameSelection` (Set<GameId>): toggle/selectAll/clear/count/isSelected. |
| `rowView.ts` | `LibraryGameView` = `GameSummary` + insights + action capability registry types. |
| `deletion.ts` | `gameDependentsKinds` list (empty in V1) + ordering note for cascade. |
| fixtures + tests | Deterministic multi-dimensional library dataset + per-module unit tests. |

## Data/storage changes (schema stays v3)

- `games-repository`: improve `fetchRows` leading-index selection
  (playedAt bounds or source/normalizedTimeControl); add
  `deleteGames(ids)` (one transaction; cascade-ready extension point)
  and a cheap id-list/keys helper for select-all.
- `src/infrastructure/db/game-library-query.ts`: maps a resolved
  `GameLibraryFilters` → repository `GameQuery` (single equality +
  exclusive local-day bound instants) + exposes whether an in-memory
  search pass is needed.

## UI changes (`src/pages/GamesPage` + `src/components/games/library/`)

- Replace the summary-list composition with the library:
  header + Import entry (existing ImportPanels in a collapsible
  section), search field, filter bar, results toolbar (count + select
  all), rows (checkbox, players, result, date, TC, platform, side,
  insights slot, action menu w/ delete), selection toolbar (count +
  disabled Analyze + Delete), delete confirmation dialog.
- Mobile card list; filters collapse on small screens.
- States: loading skeleton, no games, no matches (+ clear filters),
  error, import-in-progress banner.
- Accessibility: labelled inputs/checkboxes/buttons, focus states,
  `aria-live` result counts, dialog semantics, never color-only.
- URL state: `useGameLibraryUrlState` codec over `useSearchParams`
  (debounced search); selection kept in the page controller (not URL).
- Windowed render (e.g. 100 rows) + "Show more".

## Testing changes

- Domain unit tests for every dimension + combinations, local-timezone
  preset/custom/boundary/clear behavior (pinned TZ + offset cases),
  search field matching, selection rules, deletion ordering.
- Component tests: filter/search/select/count/empty/loading/error/
  import states, delete dialog confirm+cancel.
- Repository tests: query pushdown + deleteGames batch + select-all ids.
- E2E (`tests/e2e/game-library.spec.ts`): open Library → filter →
  verify → search → select → change/clear filters → delete selected →
  verify removal, with mocked provider fixtures + persisted IndexedDB.
- Full deterministic fixtures reused across layers.

## Verification

Narrowest-first then full gate: focused vitest runs → `npm run lint`,
`npm run typecheck`, `npm run format:check`, `npm run test`,
`npm run build`, `npm run dev` smoke, `npm run test:browser`, `npm audit`.

## Files affected

- Domain new: `src/domain/gameLibrary/*`.
- DB: `games-repository.ts(+test)`, new `game-library-query.ts(+test)`.
- UI: `GamesPage.tsx(.module.css)`, new `components/games/library/*`,
  hooks/URL hook; delete superseded `components/games/gameListFilters*`
  + `GameListFiltersBar*` + `ImportedGamesList*` after migration.
- Tests + e2e as above.
