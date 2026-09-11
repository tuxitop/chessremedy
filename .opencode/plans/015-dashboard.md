# Plan — Feature 015: Dashboard

> Source of truth: `.opencode/specs/features/015-dashboard.md` (frozen).
> Required context per `.opencode/CONTEXT-MAP.md`: `ARCHITECTURE.md` §6a; ADRs
> `decisions/ADR-010`, `decisions/ADR-013`, `decisions/ADR-023`,
> `decisions/ADR-024`, `decisions/ADR-031`; domain `domain/statistics.md`,
> `domain/tactical-training.md`, `domain/game-model.md`,
> `domain/game-library.md`; research `research/charting-library.md`. ADR-020 is
> also consumed for the provenance footer (spec §4).
>
> Feature 015 is **presentation only**: it consumes the Feature-014
> `StatisticsService` read-only, adds no domain math, starts no engine, touches
> no network and changes no schema. Every displayed value, state, sample size
> and version comes from a Feature-014 result. A number the Dashboard could
> compute is a Feature-014 defect; a chart Feature 014 rendered is a Feature-015
> defect.
>
> This plan is organized as stages 1–7 (dependency + pure selectors → hook →
> chart primitives → game-analysis section → training section → page assembly →
> browser/full gate). Each stage lands with its own tests and a narrow gate; the
> full gate runs at the end.

---

## 1. Objective

Deliver the Feature-015 slice per the spec:

1. **`/dashboard` page** — a responsive, theme-aware layout with a game-analysis
   filter bar, a game-analysis section (summary cards, rating progress, accuracy
   trend, error trends, game-phase errors), a set-scoped training section
   (current cycle, per-cycle accuracy/time/hints/retries/completion, cross-cycle
   deltas, weakest categories, repeatedly failed puzzles), and a provenance
   footer.
2. **Thin application/presentation layer** — a `useDashboard` hook that maps URL
   filter state to a canonical `StatisticsQuery` and calls the Feature-014
   service, plus pure React-free presentation selectors and Recharts wrapper
   components.
3. **Honest-state rendering** — `ok` shows value + `n = X`; `insufficient`
   (n < 5) hides the value and shows "Insufficient data (n = X)"; `empty` shows
   "No data"; `notDetected` shows "Tactics not scanned"; absent is never `0`;
   charts plot gaps for non-`ok` points.
4. **Accessibility + responsiveness** — accessible name, text summary and a
   disclosure data table for every chart; keyboard/touch operation; light/dark
   theme tokens; desktop/tablet/mobile layouts.
5. **One new runtime dependency** — `recharts` (ADR-010), MIT, latest stable per
   the `AGENTS.md` Dependency policy. No version pin.

No new persistence, no new domain rules, no new service methods.

---

## 2. Scope

### In scope

- `src/pages/DashboardPage.tsx` (replaces the placeholder) + its CSS module.
- `src/hooks/useDashboard.ts` — URL filter state, query construction, per-slice
  async reads, training-set selection, `dataVersionKey`, retry.
- `src/presentation/dashboard/` — pure selectors/formatters (no React): aggregate
  display mapping, trend/rating → chart points, partition labels, provenance,
  default training-set selection, weakest-phase label.
- `src/components/dashboard/` — filter bar, summary cards, partition selector,
  chart wrappers, training section, set selector, provenance footer, page-state
  placeholders, chart error boundary, shared accessible `ChartCard`/`DataTable`.
- Lazy-load the dashboard route (Recharts bundle) like the other heavy pages.
- Deterministic component/hook tests against an injected fake statistics source;
  pure selector tests; a static "no domain math" guard; one Playwright smoke.

### Out of scope (restated from the spec; owned elsewhere)

- Any statistics, classification, accuracy, phase, cycle-metric or mastery
  computation (Feature 014).
- Any engine work, re-analysis, detection, puzzle generation or import.
- Editing/deleting data (read-only surface).
- Per-puzzle scheduling / "due" / "next review" / FSRS language (ADR-031).
- A materialized statistics cache (Feature 014 defers it).
- Statistical-significance claims, rating conversion or cross-platform/cross
  time-control combination.
- Schema changes, new tables, new repositories, sync (Feature 016).
- Game Library filter dimensions not surfaced here (`search`, `side`, `result`,
  `analysis`, `hasBlunders`, `hasMissedTactics`).

---

## 3. Existing code to reuse (verified anchors)

### Statistics service and contracts — consume, never recompute

- `src/infrastructure/statistics/browser.ts:26-43` —
  `getBrowserStatisticsService()` (memoised singleton). Its
  `ensureSummariesForRows` is only resolved when a read passes
  `backfill: true`; the Dashboard never does, so the Feature-008 analysis
  service (and Stockfish) is never constructed (`browser.ts:4-9`).
- `src/infrastructure/statistics/statistics-service.ts:84-94` —
  `StatisticsResult<T>` typed result (`{ ok:true, result }` |
  `{ ok:false, reason, message? }`).
- `statistics-service.ts:96-113` — `StatisticsReadOptions`
  (`dataVersionKey`, `backfill`) and `StatisticsTrendOptions`
  (`granularity`).
- Service methods and their exact result shapes:
  - `gameMetrics` (`statistics-service.ts:197-233`, report type `116-118`).
  - `trendSeries` (`236-271`).
  - `ratingHistories` (`274-300`).
  - `phaseMetrics` (`303-358`, report type `120-123`).
  - `trainingSetStats` (`361-381`).
  - `weakestCategories` (`384-404`).
  - `repeatedlyFailed` (`407-427`).
- `src/domain/statistics/types.ts:28-66` — `MetricState`,
  `Aggregate`, `Sample`, `AccuracyAggregate`, `MIN_SAMPLE_SIZE = 5`,
  `STATISTICS_VERSION`.
- `types.ts:84-94` — `StatisticsQuery`; `96-107` `StatisticsGameRow`;
  `183-209` `GameMetrics`/`PhaseMetricCounts`/`PhaseMetrics`; `222-232`
  `VersionSummary`; `263-283` `TrendPoint`/`TrendSeries`; `285-300`
  `RatingPoint`/`RatingHistory`.
- `src/domain/statistics/compute.ts:94-125` — `GameMetricsComputation`,
  `TrendComputation`, `RatingComputation`, `PhaseMetricsPartition`,
  `PhaseComputation` result field names (the hook's slice types).
- `src/domain/statistics/training.ts:57-74` — `CycleStats` (status, `partial`,
  `metrics`, `firstTryAccuracy`, `solveRate`, `solvingTime`);
  `162-179` `TrainingSetStats` (`cycles`, `currentCycle`, `completedCycles`,
  `inProgressCycles`, `abandonedCycles`, `crossCycleComparison`);
  `228-240` `CategoryStats` (`ranked`); `302-311`
  `RepeatedlyFailedPuzzle`.
- `src/domain/statistics/aggregate.ts:17-54` — `emptyAggregate`,
  `notDetectedAggregate`, `aggregateOf`, `rate` (the state boundary the
  presentation mapping mirrors; the Dashboard does not call these).

### Presentation/formatting to reuse

- `src/domain/analysis/classificationMeta.ts:109-114` — `formatAccuracy`
  (accuracy with one decimal; `null` → em-dash). See ambiguity A2 for the
  argument shape.
- `src/domain/puzzle/objectiveLabel.ts:14-24` — `OBJECTIVE_LABELS`,
  `objectiveLabel`; `30` `BLUNDER_OBJECTIVE_LABEL` (weakest-category labels).
- `src/components/puzzles/cycles/labels.ts:4-16` — `CYCLE_STATUS_LABELS`,
  `SET_STATUS_LABELS`, `cycleStatusLabel`; `36-38` `formatPercent`
  (`null` stays `null`).
- `src/domain/chess/gameSource.ts:13-18` — `GAME_SOURCE_LABELS` (canonical
  Lichess/Chess.com order is `LIBRARY_PLATFORMS`).
- `src/domain/chess/timeControl.ts:26-35` — `TIME_CONTROL_CATEGORIES`
  (ADR-013 order).
- `src/domain/chess/analysis.ts:15-16` — `GAME_PHASES`
  (`opening`, `middlegame`, `endgame`); `52` `ANALYSIS_VERSION`.
- `src/domain/chess/classification.ts:18` — `CLASSIFICATION_VERSION` (outdated
  labeling only; never recomputed).
- `src/domain/statistics/version.ts:41-85` — `VersionSummary` construction and
  `mixedEngineVersions`/`mixedClassificationVersions`.
- `src/styles/tokens.css:1-66` — light/dark tokens; `99` `--touch-target-min`;
  `100` `--container-max`.

### Filter/date model and URL codec to reuse

- `src/domain/gameLibrary/filters.ts:14-55` — `LIBRARY_PLATFORMS`,
  `PlatformFilter`, `TimeControlFilter`, `GameLibraryFilters`,
  `DEFAULT_LIBRARY_FILTERS`; `142-181` `filtersFromParams` /
  `paramsFromFilters` (the canonical `q`/`tf`/`from`/`to`/`tc`/`pl` codec).
- `src/domain/gameLibrary/timeframe.ts:11-31` — `TIME_FRAME_PRESETS`,
  `TimeFrame`, `TimeWindow`; `88-102` `validateTimeFrame`; `108-130`
  `resolveTimeFrame`.
- `src/hooks/useGameLibrary.ts:181-247` — the URL-state + effect + invalid-range
  "keep last valid view" pattern to mirror (`207-213`).
- `src/components/games/library/GameLibraryToolbar.tsx:86-241` — the canonical
  filter controls/labels (`23-41` labels; `115-165` time-control/platform
  selects; `218-241` custom range + inline hint).

### Training data and components to reuse

- `src/infrastructure/db/training-sets-repository.ts:34-78` — repository
  interface; `91-95` `list({ status })`; `101-104` `getOpenBlock()`.
- `src/domain/training/cycleMetrics.ts:208-238` — `CycleComparison`,
  `compareCycleMetrics` (Feature 014 already computes
  `TrainingSetStats.crossCycleComparison`; the Dashboard reads it, never
  recomputes it); `289-321` `cycleTimeGoal(current, previous)` (the canonical
  "beat half the previous cycle's time" target, reused as guidance).
- `src/components/puzzles/cycles/CycleMetricsPanel.tsx` — canonical per-cycle
  metric rows with sample sizes (reuse for the current-cycle card).
- `src/components/puzzles/cycles/CycleComparison.tsx` — canonical same-set
  measured-delta table with the no-causation note (reuse for the improvement
  view; relative deltas are added by a small dashboard card).
- `src/pages/MasteredPuzzlesPage.tsx:52-113` — read-only load/empty/error list
  pattern; `217` the `/games/:id/puzzles` link convention.
- `src/pages/TrainingHomePage.tsx:451-516` — set listing + `lastActivityAt`
  computation (see ambiguity A5).

### Application/page patterns to mirror

- `src/app/router.tsx:20-47` — `lazy` + `Suspense` pattern for heavy pages;
  `96` the current eager dashboard route to change.
- `src/app/routes.ts:3-17` — `ROUTES.dashboard` already exists; `45-52`
  `NAV_ITEMS` already lists Dashboard.
- `src/hooks/useTheme.ts` + `src/components/layout/ThemeToggle.tsx` — the theme
  is a `data-theme` attribute on `<html>`; charts must read theme tokens.
- `src/test/test-utils.tsx:12-27` — `renderWithProviders` (MemoryRouter).
- `src/test/setup.ts:1-51` — test setup to extend with Recharts stubs.

---

## 4. Files/modules to create or modify

### New — presentation selectors (`src/presentation/dashboard/`, pure, no React)

- `index.ts` — barrel.
- `aggregateDisplay.ts` — `AggregateDisplay`, `aggregateDisplay(aggregate, format)`.
- `chartPoints.ts` — `TrendChartPoint`, `RatingChartPoint`,
  `trendToChartPoints`, `ratingToChartPoints`, `mergeTrendSeries`.
- `formatters.ts` — `formatCount`, `formatRating`, `formatAccuracyDisplay`
  (delegates to `formatAccuracy`), `formatPercentValue`, `formatDashboardTime`
  (`mm:ss` / `h:mm:ss`), `formatSample`.
- `labels.ts` — `PARTITION_LABELS`, `partitionLabel(platform, timeControl)`,
  `PHASE_LABELS`, `ERROR_METRIC_LABELS`, `TRAINING_METRIC_LABELS`,
  `weakestCategoryLabel`.
- `provenance.ts` — `ProvenanceSummary`, `summarizeProvenance(versions,
statisticsVersion)`, `isOutdated(versions)` (label only; see A3).
- `query.ts` — `dashboardQueryFromFilters(filters, now)`,
  `dashboardFilterHint(filters)`, `mixedDimensions(filters)`.
- `selection.ts` — `selectDefaultTrainingSet(active, archived, openBlock)`,
  `partitionOptions(partitions)`, `weakestPhase(phases, metric)`.

### New — application hook (`src/hooks/`)

- `useDashboard.ts` — `DashboardStatisticsSource` (narrow structural interface
  the concrete `StatisticsService` satisfies), `UseDashboard`, `useDashboard`.

### New — dashboard components (`src/components/dashboard/`)

- `ChartCard.tsx` + `.module.css` — accessible frame (title, `role="img"`
  `aria-label`, text summary, `<details>` data table, loading/empty/error states)
  and the `ChartErrorBoundary` mount point.
- `ChartErrorBoundary.tsx` — class component isolating one chart's render
  failure with an inline retry.
- `DataTable.tsx` — the disclosure table (scroll-safe, stacked on mobile).
- `DashboardFilterBar.tsx` + css — platform/time-control/time-frame controls and
  custom-range inline hint.
- `PartitionSelector.tsx` + css — single-partition vs all-partitions control.
- `SummaryCards.tsx` + css — the `gameMetrics` cards.
- `DashboardGameSection.tsx` + css — cards + rating/accuracy/error/phase charts.
- `DashboardTrainingSection.tsx` + css — set selector + training cards/charts.
- `TrainingSetSelector.tsx` + css — active/archived sets + open block.
- `ProvenanceFooter.tsx` + css.
- `DashboardStates.tsx` + css — loading/empty/no-analysis/no-training/load-error
  placeholders.
- `charts/TrendLineChart.tsx` — multi-series line chart (accuracy/error trends).
- `charts/RatingProgressChart.tsx` — per-partition rating line (small multiples).
- `charts/PhaseErrorsChart.tsx` — grouped bar chart.
- `charts/WeakestCategoriesChart.tsx` — horizontal bars.
- `charts/CycleTrendChart.tsx` — generic per-cycle line/bar (accuracy, time,
  hints/retries, completion).
- `charts/useChartTheme.ts` — theme token strings (light/dark).
- `charts/usePrefersReducedMotion.ts` — reduced-motion gate for Recharts.

### New — page

- `src/pages/DashboardPage.tsx` (replace the placeholder) + `DashboardPage.module.css`.

### New — tests/fixtures (test-only, deterministic)

- `src/test/fixtures/dashboard/fakeStatistics.ts` — the injectable fake
  `DashboardStatisticsSource` (call recorder + configurable results).
- `src/test/fixtures/dashboard/scenarios.ts` — the required fixture matrix
  (reusing `src/domain/statistics/fixtures/builders.ts` where possible).
- Tests: `src/presentation/dashboard/*.test.ts`,
  `src/hooks/useDashboard.test.ts`,
  `src/components/dashboard/**/*.test.tsx`,
  `src/pages/DashboardPage.test.tsx`,
  `src/presentation/dashboard/noDomainMath.test.ts`,
  `tests/e2e/015-dashboard.spec.ts`.

### Modified

- `package.json` / `package-lock.json` — add `recharts`.
- `src/app/router.tsx` — lazy-load `DashboardPage` (`lazy` + `Suspense`).
- `src/test/setup.ts` — stub `ResizeObserver` and `window.matchMedia` when the
  environment does not provide them (Recharts `<ResponsiveContainer>` +
  reduced-motion).

### Explicitly not modified

- `src/domain/statistics/**`, `src/infrastructure/statistics/**` — no new math,
  no new service methods, no threshold change.
- `src/infrastructure/db/**`, `src/domain/training/**`, `src/domain/analysis/**`
  — no schema, repository or domain change.
- `src/app/routes.ts` — `ROUTES.dashboard` and the nav item already exist.
- The Game Library page/toolbar — its filter model is reused, not refactored.

---

## 5. Domain/data changes

### 5.1 No schema or data change

Feature 015 adds **no** persisted table, no Dexie migration, no repository, no
sync surface and no statistics cache. It reads through the existing
`getBrowserStatisticsService()` only. No value is persisted, cached to
IndexedDB, or synced.

### 5.2 Honest-state presentation mapping (pure)

`aggregateDisplay(aggregate, format)` is the single mapping used by every card
and tooltip:

| State          | `hidden` | `text`          | `stateLabel`                | `n`        |
| -------------- | -------- | --------------- | --------------------------- | ---------- |
| `ok`           | false    | `format(value)` | `null`                      | `sample.n` |
| `insufficient` | true     | `null`          | `Insufficient data (n = X)` | `sample.n` |
| `empty`        | true     | `null`          | `No data`                   | `0`        |
| `notDetected`  | true     | `null`          | `Tactics not scanned`       | `sample.n` |

- The mapping reads `state`/`sample`/`value` verbatim; it never derives a state
  from a number and never calls the Feature-014 aggregate constructors.
- `format` is a presentation formatter per metric (accuracy one decimal, counts
  integer, rating integer, percent, `mm:ss`/`h:mm:ss`).
- Every `ok` value renders with its `n = X <unit>` sample label.

### 5.3 Chart-point mapping (pure)

- `trendToChartPoints(series)` selects `periodKey`/`periodStart`/`periodEnd`,
  maps `state === 'ok' ? value : null`, and carries `state`/`n` for the
  tooltip. One x slot per period is preserved (gaps included); no value is
  computed and nothing is interpolated.
- `mergeTrendSeries(seriesList)` builds the Recharts row array keyed by
  `periodKey` with one `dataKey` per concrete partition; all partitions share
  the same period enumeration, so gaps stay per-series and no cross-partition
  merge occurs.
- `ratingToChartPoints(history)` maps stored `RatingPoint`s
  (`x = Date.parse(playedAt)`, `y = rating`) with **no** interpolation or
  carry-forward. Rating charts render one line per partition (small multiples),
  so no numeric-x merge is required (see 6.3).

### 5.4 Query construction (pure)

`dashboardQueryFromFilters(filters, now)` returns a canonical
`StatisticsQuery`:

```
{ platform, timeControl, side: 'all', result: 'all',
  dateRange: filters.timeFrame, now, /* combine omitted (never merge) */ }
```

- `platform`/`timeControl`/`dateRange` come from the canonical
  `GameLibraryFilters`; `search`, `side`, `result`, `analysis`, `hasBlunders`,
  `hasMissedTactics` are not surfaced and are passed as their canonical
  defaults.
- An invalid/incomplete custom range yields `dashboardFilterHint(filters)`; the
  hook then keeps the last valid view and issues no query (mirror
  `useGameLibrary.ts:207-213`).

### 5.5 Provenance (label only)

`summarizeProvenance(versions, statisticsVersion)` formats the distinct
`analysisVersion`/`classificationVersion`/`gamePhaseVersion`/`detectionVersion`
arrays, engine identities and the mixed flags. `isOutdated(versions)` is a
presentation comparison of the reported versions against the current
`ANALYSIS_VERSION`/`CLASSIFICATION_VERSION` constants (A3) — it computes no
statistic and mutates nothing.

### 5.6 Training aggregates

The training section calls `trainingSetStats`, `weakestCategories` and
`repeatedlyFailed` for the **selected set only**. It never accepts the
game-analysis filters (Feature 014 §8, spec §3). Cross-cycle deltas come from
`TrainingSetStats.crossCycleComparison`; the time-halving target reuses
`cycleTimeGoal(current.metrics, previous.metrics)` (canonical Feature 013
guidance, never a gate).

---

## 6. UI changes

### 6.1 Page layout and states

Three regions in order, then the footer:

1. Filter bar (game-analysis scope).
2. Game-analysis section (summary cards, rating, accuracy, error trends, phase).
3. Training section (set-scoped), explicitly labeled as set-scoped.
4. Provenance footer (ADR-020).

Page states: `loading`; `ready`; `empty` (no games — first-run guidance linking
to Games/Analysis); `no-analysis` (games but no eligible analysis — charts show
their own empty/insufficient states, never zeros); `no-training` (no set —
explicit empty state linking to `/puzzles`); `load-error` (inline
"Could not load statistics" with retry; other sections stay usable). Each
chart/card keeps its own independent slice state so one failed read does not
blank the page.

### 6.2 Filter bar

- Reuses the canonical `GameLibraryFilters` dimension types/labels and the
  canonical URL codec (`filtersFromParams`/`paramsFromFilters`) via a
  `useSearchParams`-backed `useDashboardFilters` inside `useDashboard`.
- Controls: platform (`All`, Lichess, Chess.com — canonical order), time control
  (`All` + six ADR-013 categories), time frame (presets + custom range).
  `search`, `side`, `result` are not rendered.
- Custom range validated with `validateTimeFrame`; an inline hint is shown and
  the last valid view is kept (never a load error).
- A mixed-dimension note is visible whenever `platform === 'all'` or
  `timeControl === 'all'`, naming the mixed dimensions and stating that
  partitions are shown separately (rapid and blitz are never combined).
- **Default view decision (A1):** the URL default is the canonical
  `All/All` (matching `DEFAULT_LIBRARY_FILTERS`), and the page renders
  Feature-014's dimensioned partitions. A `PartitionSelector` defaults to the
  first concrete partition so the _default rendering_ is a single concrete
  partition; "All partitions" is an explicit user choice. No silent merge.

### 6.3 Game-analysis section

- **Summary cards** (`SummaryCards`) from `gameMetrics` for the active
  partition(s): Games total/analyzed/detected; Accuracy (one decimal); the three
  per-game error rates; missed tactics per game (or "Tactics not scanned");
  median blunders per game. Each aggregate card uses `aggregateDisplay` + `n`.
  When `All` yields several partitions, cards render per labeled partition (a
  partition selector on mobile).
- **Rating progress** (`RatingProgressChart`): `ratingHistories`, one line per
  concrete partition, rendered as small multiples (one card per partition) so
  no cross-partition numeric-x merge is needed. X = time, Y = rating. Missing
  ratings/undated games produce no point; a note explains gaps as "no rated
  game". An optional period mode uses `trendSeries('rating', { granularity })`
  (latest rated game per period).
- **Accuracy trend** (`TrendLineChart`): `trendSeries('accuracy', {
granularity })`, default `week` (day/month selectable). One merged row per
  period, one line per concrete partition; non-`ok` points are gaps. Tooltip
  shows period, value (when `ok`), state and `n`.
- **Error trends** (`TrendLineChart`): `trendSeries` for
  `inaccuraciesPerGame`, `mistakesPerGame`, `blundersPerGame`,
  `missedTacticsPerGame` (default per-game rates). Absolute counts
  (`inaccuracies`, `mistakes`, `blunders`, `missedTactics`) are an explicit
  alternate view loaded lazily. Missed tactics are `notDetected` ("Tactics not
  scanned") without a completed detection pass, never a zero line. One series
  per concrete partition.
- **Game-phase errors** (`PhaseErrorsChart`): `phaseMetrics`, default
  normalized `errorsPer100Moves` for the four error classes; absolute counts are
  the alternate view. Grouped bars per phase; the phase with the highest
  normalized rate is labeled "weakest phase" (presentation label only). Missed
  tactics by phase honor `notDetected`. The phase chart is scoped to one
  partition at a time via the partition selector.

### 6.4 Training section (set-scoped)

- **Set selector** (`TrainingSetSelector`): open Woodpecker block first, then
  active custom sets, archived sets behind an affordance. Default = open block,
  else the most recently active set (A5). No set → explicit empty state linking
  to `/puzzles`. A set deleted between reads refreshes the selector and
  re-selects the next available set or the empty state.
- **Current cycle** — cycle number, status label (`inProgress`/`completed`/
  `abandoned`), progress (`puzzlesCompleted` vs set size; skipped shown
  separately); absent → "Not started", never `0`. `inProgress` is labeled
  partial; `abandoned` is shown separately and never as completed.
- **Accuracy by cycle** — `firstTryAccuracy` per cycle (solve rate alternate),
  one point per cycle in cycle-number order; `insufficient` cycles are gaps.
- **Solving time by cycle** — total and average/median per cycle, in
  cycle-number order; shows the `cycleTimeGoal` "beat half the previous cycle"
  target when a previous cycle exists (guidance only).
- **Hints and retries by cycle** — `hintsUsed`/`puzzlesRequiringHint` and
  `retries`/`puzzlesRequiringRetry` per cycle.
- **Completion rate by cycle** — completed vs skipped per cycle.
- **Improvement** — `TrainingSetStats.crossCycleComparison` current/previous/
  `absoluteDelta` (and `relativeDelta` when defined) for accuracy and solving
  time. Reuses `CycleComparison` (measured deltas, no causation claim) plus a
  compact card for relative deltas.
- **Weakest categories** — horizontal bars of `solveRate` for `ranked`
  categories (tactical objective or `blunder`); unranked categories are shown
  separately as "not enough data". Labels via `objectiveLabel` /
  `BLUNDER_OBJECTIVE_LABEL`.
- **Repeatedly failed** — compact table/list with failure count, cycle count and
  last-failed time, linked to `/games/:sourceGameId/puzzles` (the existing
  convention, `MasteredPuzzlesPage.tsx:217`). No scheduling language.

### 6.5 Accessibility

- Every chart sits in a `ChartCard` with a heading, a `role="img"`
  `aria-label` naming metric + partition + granularity, and a disclosure
  (`<details>`) data table with the same values, states and `n`.
- State labels are text ("Insufficient data (n = X)", "No data", "Tactics not
  scanned", "Partial cycle"); series identity is conveyed by legend text as well
  as colour; error classes keep their canonical Feature-009 labels/colours with
  text.
- Tooltips are reachable by keyboard focus and touch tap; the same information
  is in the data table, so no information is hover-only.
- `aria-live="polite"` announces scope/loading changes without stealing focus;
  filter/set changes keep focus and do not scroll-jump.
- `prefers-reduced-motion: reduce` disables Recharts animations
  (`usePrefersReducedMotion` → `isAnimationActive={false}`).

### 6.6 Responsive and themes

- Mobile-first single column; the filter bar wraps; sections stack; no
  horizontal page scroll. Desktop/tablet use a multi-column card grid.
- Each chart uses `<ResponsiveContainer>` with a minimum height so it never
  collapses; labels/legends wrap or shorten.
- Tap targets ≥ `--touch-target-min` (44 px); tables render as stacked cards on
  mobile.
- When `All` produces many partitions, mobile shows one partition at a time
  (partition selector / paged cards) rather than an unreadable multi-line chart.
- Chart grid/axis/label colours come from theme tokens
  (`useChartTheme` → `var(--color-*)`); no fixed dark-on-light defaults. Both
  light and dark must render legibly.

---

## 7. Infrastructure changes

### 7.1 Dependency

- Add **`recharts`** (ADR-010), MIT-licensed, at the latest stable version.
  Install with `npm install recharts@latest`; the resolved version lives in
  `package.json`'s caret range and `package-lock.json` (no pin in this plan or
  any ADR, per the Dependency policy).
- Import named components only (e.g. `LineChart`, `Line`, `BarChart`, `Bar`,
  `XAxis`, `YAxis`, `Tooltip`, `Legend`, `CartesianGrid`,
  `ResponsiveContainer`) so Vite tree-shaking stays effective.
- Transitive dependencies (`react-redux`, `immer`, `reselect`, `d3-*`,
  `victory-vendor`, `react-smooth`) are MIT/ISC/BSD/Apache and compatible with
  ADR-027; verify with `npm audit` and a license check during Stage 1.
- **A6:** the planning environment could not reach the npm registry, so the
  current latest stable could not be confirmed here. `research/charting-library.md`
  records `3.10.1` (Jul 2025) as the last-known value; the implementation
  resolves `@latest` and records the actual version in the lockfile.

### 7.2 Test environment

- Extend `src/test/setup.ts` with a guarded `ResizeObserver` stub (Recharts
  `<ResponsiveContainer>`) and a `window.matchMedia` stub (reduced-motion +
  `useBoardSize`-style queries), only when absent.
- Chart components accept an optional fixed `width`/`height` override used by
  tests so a size is available without a live ResizeObserver.
- No engine, network, MSW or real IndexedDB is needed: the hook takes an
  injected `DashboardStatisticsSource`.

### 7.3 Performance

- No engine, no network; all data is Feature-014 local reads. The Dashboard
  never passes `backfill: true`.
- Reads are independent per slice (progressive load): summary cards from
  `gameMetrics` render first; each chart resolves on its own.
- Default trend granularity is `week` (bounded points). Day granularity is
  available but the chart plots at most a bounded window (initial budget:
  `MAX_PLOT_POINTS = 200`, most recent periods) with a note; the disclosure
  table shows the same window. Down-sampling never changes a value (spec
  Performance).
- `dataVersionKey` (mount token + retry token, A4) reuses Feature-014's
  memoization; the Dashboard adds no second cache.
- Record the measured interaction budget (filter-to-render on the fixture and a
  large synthetic series) in the Stage 6/7 notes; Recharts SVG is acceptable for
  the bounded V1 counts.

---

## 8. Tests

### Deterministic fixtures / fakes

`src/test/fixtures/dashboard/fakeStatistics.ts` implements
`DashboardStatisticsSource`, records the calls made and returns configured
`StatisticsResult`s. `scenarios.ts` reuses the Feature-014 fixture builders
(`src/domain/statistics/fixtures/builders.ts`, `scenarios.ts`) and covers at
minimum:

- `ok`, `insufficient` (`n = 4`), `empty` and `notDetected` aggregates.
- Trend series with an explicit empty gap, an `insufficient` point and a
  period-boundary point.
- Two concrete partitions (Lichess + Chess.com, rapid + blitz) proving no merge.
- Rating histories with a missing rating and an undated game.
- Phase metrics with differing per-phase move exposure.
- A training set with an `inProgress`, a `completed` and an `abandoned` cycle,
  an all-skipped cycle, an `insufficient` cycle, ranked + unranked weakest
  categories and a repeatedly-failed puzzle.
- A mixed-version/outdated `VersionSummary`.

Fixtures are pure, deterministic and separated from production data.

### Test cases by area

- **Selectors** (`src/presentation/dashboard/*.test.ts`): aggregate mapping for
  all four states; trend/rating point mapping preserves gaps and slots; format
  functions; partition/provenance/weakest-phase labels; query construction and
  invalid-range hint.
- **Hook** (`useDashboard.test.ts`, `renderHook`): calls only the Feature-014
  methods with `side:'all'`, `result:'all'`, no `combine`, no `backfill`;
  independent slice states; failed read → error slice + retry; invalid custom
  range keeps the last valid query; set switch re-reads training only and does
  not change game slices; game filters do not change training slices.
- **No calculation** (`noDomainMath.test.ts`): static source guard that the
  dashboard/presentation modules never value-import the statistics computation
  or accuracy/classification math (type-only imports and the approved
  presentation helpers are allowed).
- **Component tests** (`src/components/dashboard/**`, `DashboardPage.test.tsx`):
  - `n = X` shown for `ok`; value hidden + placeholder for
    `insufficient`/`empty`/`notDetected`; a chart does not plot an
    `insufficient` point.
  - With `platform`/`timeControl` = `All`, two labeled partitions render and no
    rapid/blitz value appears in one series; a mixed note is visible.
  - Rating series for Lichess and Chess.com are distinct; no averaged line.
  - Phase default is `errorsPer100Moves`; counts via the alternate view; missed
    tactics honors `notDetected`.
  - Training charts do not change with game filters and do change with the set
    selector; no "due"/"next review" text exists.
  - Cross-cycle deltas match the fake; no causation wording.
  - Provenance mixed/outdated labels render.
  - URL state serializes/restores filters; invalid custom range shows the inline
    hint and keeps the last valid view.
  - Failed read shows inline error/retry and fabricates no value; a chart error
    boundary isolates a failing chart.
  - Accessibility: each chart has an accessible name and a text/data
    equivalent; state labels are text; reduced motion disables animation.
  - Themes: chart props use theme tokens (no fixed hex).
- **Responsive/browser** (`tests/e2e/015-dashboard.spec.ts`, Playwright when
  Chromium is available): desktop/tablet/mobile widths without overflow; a touch
  tap reveals point detail; no console errors.

### Narrow-first order

Focused selector tests first, then hook, then component tests, then the full
gate (`npm run lint`, `typecheck`, `format:check`, `test`, `build`, `dev`,
`test:browser`, `npm audit`) per `AGENTS.md`.

---

## 9. Migration considerations

- **No migration.** No schema version change, no new table, no data backfill and
  no settings key. The existing statistics worker is used transparently by the
  service above its row threshold.
- `recharts` is the only addition; removing it later removes only the dashboard
  chart components.
- The dashboard reads the live local database; there is no persisted dashboard
  state to migrate. URL filter state is backward-compatible with the Game
  Library codec.

---

## 10. Risks and spec ambiguities

### Spec ambiguities resolved with recommended defaults

- **A1 — "The default is a single concrete partition" vs the canonical URL
  codec.** `paramsFromFilters` omits `all` values, so a data-derived concrete
  default cannot be distinguished from an explicit `All`. **Recommended:** keep
  the canonical `All/All` URL default and render Feature-014's dimensioned
  partitions; a `PartitionSelector` defaults to the first concrete partition so
  the rendered default is a single partition, and "All partitions" is an
  explicit choice. This satisfies "never a silent merge" and keeps the canonical
  codec. Flag for owner confirmation.
- **A2 — `formatAccuracy` argument shape.** The spec's presentation mapping
  writes `formatAccuracy(value, { decimals: 1 })`, but the implemented Feature-009
  helper is `formatAccuracy(value, decimals = 1)` (`classificationMeta.ts:109`).
  **Recommended:** call `formatAccuracy(value, 1)`; treat the spec form as
  documentation shorthand. No behavior change.
- **A3 — "outdated" is not exposed as a Feature-014 field.** `VersionSummary`
  carries distinct version arrays and mixed flags only. **Recommended:** derive
  an `outdated` label in `provenance.ts` by comparing the reported
  `analysisVersion`/`classificationVersion` values against the current
  `ANALYSIS_VERSION`/`CLASSIFICATION_VERSION` constants (label only, no math);
  the footer links to the Game Library for opt-in re-analysis. Flag for owner
  confirmation if a dedicated Feature-014 field is preferred.
- **A4 — `dataVersionKey` scope.** The spec says the hook passes a
  caller/assembler-derived version. **Recommended:** a mount token (`useId`) plus
  a retry token so each mount re-reads fresh data and within-mount filter/retry
  cycles reuse Feature-014 memoization. No correctness depends on the cache.
- **A5 — "most recently active set".** The spec does not define it.
  **Recommended:** the open block first; else the active set with the greatest
  `updatedAt` (ties by `createdAt`, then id). This needs only the sets read and
  is deterministic. Flag if cycle-recency (the `TrainingHomePage` `lastActivityAt`
  rule) is preferred instead.
- **A6 — latest `recharts` version.** The registry was unreachable while
  planning. **Recommended:** `npm install recharts@latest` and record the
  resolved version in the lockfile; `research/charting-library.md`'s `3.10.1` is
  the last-known value only.
- **A7 — training-set selection URL persistence.** The spec requires filters in
  the URL but not the set. **Recommended:** keep the selected set id in a
  separate `set` query param managed by the hook (bookmarkable), defaulting via
  A5 when absent. Flag if local state is preferred.

### Risks

- **Recharts in happy-dom.** `<ResponsiveContainer>` needs `ResizeObserver` and a
  non-zero size; tests assert on accessible names/text/tables and use the fixed
  size override, with the setup stub as a fallback.
- **Per-series rating x-axis.** Per-game rating points across partitions do not
  share timestamps; small multiples avoid an incorrect merge/interpolation.
- **Cycle snapshot size.** `CycleStats` does not expose the cycle's snapshot
  puzzle count, so the current-cycle progress denominator uses
  `TrainingSetStats.puzzleCount` (the set size). Flag if Feature 014 should
  expose the snapshot size.
- **Weakest-phase label.** "Highest normalized rate" is undefined across four
  classes; the plan sums the displayed normalized rates per phase
  (presentation-only) and labels the maximum. Flag for owner confirmation.
- **Bounded day-granularity rendering.** A presentation-level `MAX_PLOT_POINTS`
  cap must not be confused with value down-sampling; the cap only limits plotted
  points and is noted in the card.
- **Bundle size.** Recharts is heavy; lazy-loading the route and named imports
  keep it out of the initial bundle. Measure in Stage 6/7.
- **Memo growth.** The singleton statistics memo grows with distinct
  `(query, dataVersionKey)` pairs; acceptable for V1, noted for later lifecycle
  cleanup.

### Spec/implementation conflicts found

- None at the architecture level. A2 is a documentation/API-shape mismatch, not
  an architecture conflict. No frozen-spec change is proposed.

---

## 11. Acceptance criteria (spec #1–16 → stage)

| #   | Criterion                                                                                              | Stage   |
| --- | ------------------------------------------------------------------------------------------------------ | ------- |
| 1   | Renders Feature-014 values; performs no statistical calculation                                        | 1–6     |
| 2   | Every value shows `n`; `n < 5` is an explicit insufficient placeholder (charts omit the point)         | 1, 4    |
| 3   | `empty`, real zero and `notDetected` are distinct; absent is never `0`                                 | 1, 4    |
| 4   | No silent time-control/platform merge; `All` is labeled; mixed never the default                       | 4       |
| 5   | Rating lines are per `(platform, timeControl)`; no averaging/conversion                                | 4       |
| 6   | Phase default is `errorsPer100Moves`; missed tactics honor detection                                   | 4       |
| 7   | Training is set-scoped; no scheduling language; partial/abandoned labeled                              | 5       |
| 8   | Training charts cover cycle progress/accuracy/time/hints/retries/completion/deltas/categories/failures | 5       |
| 9   | Filter bar reuses the canonical dimension model + URL serialization; custom range validated            | 4       |
| 10  | Version provenance and mixed/outdated labels are surfaced (ADR-020)                                    | 6       |
| 11  | Light/dark render legibly; charts use theme tokens                                                     | 3, 6    |
| 12  | Desktop/tablet/mobile + touch; no essential information is hover-only                                  | 3, 6, 7 |
| 13  | Every chart has an accessible name and a text/data-table equivalent; state is text not colour          | 3, 6    |
| 14  | Never blocks the main thread or starts Stockfish; bounded, memoized reads                              | 2, 7    |
| 15  | `recharts` is the only new dependency, MIT, Dependency policy; no version pin                          | 1       |
| 16  | Component tests run deterministically against an injected fake service (no engine/network/IDB)         | 2–6     |

---

## 12. Verification commands

Narrow-first per stage (run from the repo root):

- Stage 1: `npx vitest run src/presentation/dashboard`
- Stage 2: `npx vitest run src/hooks/useDashboard.test.ts`
- Stage 3: `npx vitest run src/components/dashboard`
- Stage 4: `npx vitest run src/components/dashboard src/pages/DashboardPage.test.tsx`
- Stage 5: `npx vitest run src/components/dashboard`
- Stage 6: `npx vitest run src/pages/DashboardPage.test.tsx`
- Stage 7: `npm run build && npx playwright test tests/e2e/015-dashboard.spec.ts`

Full gate (Stage 7, final):

```
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev            # smoke: no browser-console errors
npm run test:browser   # when Chromium is available
npm audit
```

Load the `verify-gate` skill before running the full gate; fix underlying
causes and escalate workarounds per `AGENTS.md` Execution policy.

---

## 13. Staged implementation sequence

Each stage is dependency-ordered, lands with its own tests, and runs its narrow
gate before the next.

### Stage 1 — Dependency, test stubs, pure presentation selectors

- Add `recharts@latest`; verify the license/audit.
- Extend `src/test/setup.ts` with guarded `ResizeObserver`/`matchMedia` stubs.
- Create `src/presentation/dashboard/` (`aggregateDisplay`, `chartPoints`,
  `formatters`, `labels`, `provenance`, `query`, `selection`, `index`) with
  unit tests.
- Narrow: `npx vitest run src/presentation/dashboard` + `npm run typecheck` +
  `npm run format:check`.

### Stage 2 — `useDashboard` hook + fake statistics source

- Create `src/hooks/useDashboard.ts` (`DashboardStatisticsSource`, URL filter
  state, query construction, per-slice reads, training-set selection,
  `dataVersionKey`, retry).
- Create `src/test/fixtures/dashboard/fakeStatistics.ts` and `scenarios.ts`.
- Tests: `useDashboard.test.ts` (call-only-Feature-014, slice states, invalid
  range, set scoping, retry).
- Narrow: `npx vitest run src/hooks/useDashboard.test.ts`.

### Stage 3 — Chart primitives, `ChartCard`, error boundary

- Create `ChartCard`, `DataTable`, `ChartErrorBoundary`,
  `charts/TrendLineChart`, `charts/RatingProgressChart`,
  `charts/PhaseErrorsChart`, `charts/WeakestCategoriesChart`,
  `charts/CycleTrendChart`, `charts/useChartTheme`,
  `charts/usePrefersReducedMotion`.
- Tests: accessible name/text/table, empty-chart placeholder, error boundary,
  reduced motion, theme-token props, fixed-size test override.
- Narrow: `npx vitest run src/components/dashboard`.

### Stage 4 — Filter bar + game-analysis section

- Create `DashboardFilterBar`, `PartitionSelector`, `SummaryCards`,
  `DashboardGameSection`, `DashboardStates`.
- Tests: sample sizes/placeholders, no silent merge, rating separation, phase
  semantics, URL state + invalid range.
- Narrow: `npx vitest run src/components/dashboard`.

### Stage 5 — Training section

- Create `TrainingSetSelector`, `DashboardTrainingSection`, cycle cards/charts,
  weakest categories, repeatedly failed list (reusing `CycleMetricsPanel`,
  `CycleComparison`, `cycleTimeGoal`).
- Tests: set scoping, partial/abandoned labels, deltas match the fake, no
  scheduling language, weakest ranked/unranked.
- Narrow: `npx vitest run src/components/dashboard`.

### Stage 6 — Page assembly, router lazy-load, provenance, responsive

- Replace `src/pages/DashboardPage.tsx`; add `DashboardPage.module.css` and
  `ProvenanceFooter`.
- Modify `src/app/router.tsx` to `lazy`-load the dashboard route with
  `Suspense`.
- Tests: `DashboardPage.test.tsx` (page states, provenance, responsive layout,
  accessibility) and `noDomainMath.test.ts`.
- Narrow: `npx vitest run src/pages/DashboardPage.test.tsx`.

### Stage 7 — Browser smoke + full gate

- Add `tests/e2e/015-dashboard.spec.ts` (desktop/tablet/mobile widths, touch
  tap, no console errors).
- Measure the bundle/interaction budget and record it.
- Narrow: `npm run build && npx playwright test tests/e2e/015-dashboard.spec.ts`.
- Full gate per section 12.
