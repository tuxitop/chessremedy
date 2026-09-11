# Feature 015 — Dashboard

## Purpose

Deliver the ChessRemedy **Dashboard**: the read-only presentation layer that
renders the progress questions ("What mistakes am I repeatedly making?", "Am I
improving?", "What should I train next?") as summary cards and charts.

The Dashboard:

- **renders** values and series produced by Feature 014 (Game Analysis History
  & Statistics);
- **never calculates** statistics, classifications, accuracy, cycle metrics or
  mastery — it consumes the Feature-014 service read-only
  (`getBrowserStatisticsService()`, `StatisticsService`);
- **never starts Stockfish**, never touches the network, and never mutates
  persisted data;
- guarantees that every rendered value is honest: it always shows the sample
  size and replaces aggregates below the minimum sample size with an explicit
  "insufficient data" placeholder, and it never renders absent data as a
  literal zero.

The Dashboard is the **sole UI consumer** of Feature 014 (Feature 014 §15,
`ARCHITECTURE.md` §6a). The division is absolute: Feature 014 computes, Feature
015 presents. A number the Dashboard could compute is a Feature-014 defect; a
chart Feature 014 rendered is a Feature-015 defect.

---

## Scope

### In scope

1. The `/dashboard` page: a responsive, theme-aware layout of summary cards and
   charts over the canonical Feature-014 results.
2. A game-analysis **filter bar** (platform, time control, date range) reusing
   the canonical `domain/game-library.md` dimension model and labels.
3. Rating progress, accuracy trend, error trends (inaccuracies, mistakes,
   blunders, missed tactics) and game-phase error charts, all scoped to the
   selected concrete `(platform, timeControl)` partition(s).
4. A **training section** scoped to a selected tactical training set
   (set-scoped, never game-filtered): current cycle progress, per-cycle
   accuracy, solving time, hints/retries, completion, cross-cycle deltas,
   weakest tactical categories and repeatedly failed puzzles.
5. Explicit empty / insufficient / not-detected states for every card and
   chart, with `n = X` sample sizes.
6. Version/provenance surfacing (statistics/classification/detection versions
   and mixed-engine/classification labels; ADR-020).
7. Dark/light theme support, desktop/tablet/mobile layouts, keyboard/touch
   interaction, and a text-equivalent data view for every chart.
8. A thin presentation/application layer (a `useDashboard` hook + Recharts
   wrapper components) over the existing statistics service.
9. Deterministic component tests against an injected fake statistics service.

### Out of scope

- Any statistics computation, aggregation, classification, accuracy, phase,
  cycle-metric or mastery logic (Feature 014; consumed, never re-implemented).
- Any engine work, re-analysis, detection, puzzle generation or import.
- Editing or deleting data from the Dashboard (read-only surface).
- Individual-puzzle scheduling, "due"/retention/"next review" concepts
  (ADR-031). The Dashboard never shows scheduling language.
- A materialized statistics cache (Feature 014 explicitly defers it).
- Statistical-significance claims, rating conversion between platforms or
  cross-platform rating combination.
- New domain rules of any kind. Feature 015 adds presentation only.

---

## Relationship to other features

| Feature | Role |
|---|---|
| 003/004 | Game/time-control domain types and local persistence (via Feature 014). |
| 008/009/010 | Persisted `MoveAnalysis`, classification and detection that Feature 014 aggregates. |
| 011/012/013 | Puzzles, immutable attempts and training sets/cycles that Feature 014 aggregates. |
| 014 | **Sole data source.** Provides every value, series, state, sample size and version summary. |
| 016 | No interaction; derived statistics are never synced (Feature 014 §12). |

**Scope boundary — game filters vs. training scope.** The existing draft placed
the training charts under the game-analysis platform/time-control/date filters.
That contradicts Feature 014 §8 ("training aggregates do not take the
game-analysis filters; a training set is a deliberate user artifact"). This
spec resolves the inconsistency: the filter bar scopes the **game-analysis
section only**; the **training section is scoped by a training-set selector**
and is explicitly labeled as set-scoped. No game filter is ever applied to a
training metric.

---

## User-facing behavior

The page has three regions in order: a **filter bar**, a **game-analysis
section**, and a **training section**, followed by a **provenance footer**.

### 1. Filter bar (game-analysis scope)

- Dimensions: **platform** (`All`, Lichess, Chess.com — canonical order,
  `domain/game-library.md`), **time control** (`All`, bullet, blitz, rapid,
  classical, correspondence, unknown — ADR-013), **date range** (the canonical
  presets plus a custom range).
- Category membership is **platform-correct** (ADR-013): with platform
  `Chess.com` the `classical` filter has no games (Chess.com long games are
  `rapid`) and a `5|5` game appears under `blitz`; with `Lichess` it appears
  under `rapid`. The filter still operates on the stored
  `normalizedTimeControl`, never on a re-derived value.
- Reuses the canonical `GameLibraryFilters` dimension types and labels; it does
  **not** introduce a parallel filter model (`domain/game-library.md`).
  `search`, `side` and `result` are not surfaced; the Feature-014 query is
  built with `side: 'all'`, `result: 'all'`.
- The selected filters are reflected in the **URL** (same query-param
  serialization convention as the Game Library) so a dashboard view is
  bookmarkable and restorable.
- An explicit custom range is validated with the canonical rules
  (`yyyy-mm-dd`, `from ≤ to`); while a range is incomplete/invalid the page
  keeps the last valid view and shows an inline hint (never a load error).
- A **mixed view is never the default.** The default is a single concrete
  `(platform, timeControl)` partition. When the user selects `All` for a
  dimension, the page renders the dimensioned results returned by Feature 014
  (one series/partition per concrete pair) with each partition labeled; it
  never silently merges rapid and blitz (or any two categories).
- A visible note states which dimensions are mixed when `All` is active, and a
  "combined" partition (only ever produced by Feature 014 for an explicit,
  allowed merge) is labeled as combined.

### 2. Game-analysis section

All charts in this section are dimensioned by the filter bar. Each card/chart
shows its `n` and a state label.

#### 2a. Summary cards

Headline aggregates from `gameMetrics` for the active partition(s):

- Games (total / analyzed / detected).
- Accuracy (ADR-024 move-weighted aggregate; one decimal).
- Inaccuracies per game, mistakes per game, blunders per game.
- Missed tactics per game (or "Tactics not scanned" when `notDetected`).
- Median blunders per game.

Each card shows the raw value plus `n = X <unit>`. `insufficient` cards show
the "Insufficient data (n = X)" placeholder instead of the value; `empty` shows
"No data"; `notDetected` shows "Tactics not scanned". Cards never render a bare
`0` for absent data.

#### 2b. Rating progress

- Line chart of the user's stored rating (`Player.rating` of `Game.userColor`).
- **One line per concrete `(platform, timeControl)` partition.** Chess.com and
  Lichess ratings are never averaged, converted or placed on one line
  (PRODUCT §6, ADR-013, Feature 014 §6).
- X axis is time; Y axis is rating. Points are the per-game rating points
  (`ratingHistories`) — or, when the user chooses a period granularity, the
  latest rated game within each period (Feature 014 §6/§7). Periods/games with
  no rating are gaps, never `0`.
- Missing ratings and undated games produce no point (Feature 014 §6); the
  chart explains gaps as "no rated game".

#### 2c. Accuracy trend

- Line chart of aggregate accuracy per period (default **weekly**; day/month
  selectable) from `trendSeries('accuracy')`.
- One line per concrete `(platform, timeControl)` partition. Accuracy is the
  ADR-024 move-weighted mean; `n` is the number of games with a non-null
  accuracy.
- Points with `insufficient`/`empty` are not plotted (a gap), preserving the
  time axis. Tooltip shows period, value (when `ok`), state and `n`.

#### 2d. Error trends

- Trend chart(s) for **inaccuracies, mistakes, blunders and missed tactics**
  from `trendSeries` per period.
- Default metric is the **per-game rate** (`inaccuraciesPerGame`,
  `mistakesPerGame`, `blundersPerGame`, `missedTacticsPerGame`); the absolute
  counts (`inaccuracies`, `mistakes`, `blunders`, `missedTactics`) are an
  explicit alternate view. The chosen metric is always labeled.
- Missed tactics uses only detected games; a period with no completed
  detection pass is `notDetected` ("Tactics not scanned"), never a zero line.
- One series per concrete partition; rapid and blitz are never combined.

#### 2e. Game-phase errors

- Chart of the user's errors by **opening / middlegame / endgame**
  (`phaseMetrics`).
- Default view is the normalized **`errorsPer100Moves`** for inaccuracies,
  mistakes, blunders and missed tactics, because raw counts are not comparable
  across phases with different move exposure (Feature 014 §5). Absolute counts
  are an explicit alternate view.
- Per-phase counts use the analyzed-game sample; normalized rates use the
  per-phase user-move sample. Missed tactics by phase is `notDetected` unless a
  current completed detection pass exists.
- A grouped bar chart is the expected form; the phase with the highest
  normalized rate is labeled "weakest phase" (presentation label only — no
  causation claim).

### 3. Training section (set-scoped)

- A **training-set selector** lists the user's sets (open Woodpecker block,
  custom sets; archived sets behind an affordance). The default is the open
  block, else the most recently active set. When no set exists, the section
  shows an explicit empty state linking to `/puzzles`.
- The section is **explicitly labeled as set-scoped**; game filters do not
  apply. Training metrics are never mixed with game-analysis metrics.
- Uses `trainingSetStats`, `weakestCategories` and `repeatedlyFailed` for the
  selected set. `inProgress` cycles are labeled partial; `abandoned` cycles are
  shown separately and never as completed.

Cards/charts:

1. **Current cycle** — cycle number, status (`inProgress` / `completed` /
   `abandoned`) and progress (`puzzlesCompleted` vs the set/cycle size;
   skipped shown separately). Absent data is "Not started", not `0`.
2. **Accuracy by cycle** — per-cycle `firstTryAccuracy` (and `solveRate` as an
   alternate), one point per cycle in cycle-number order. Same set, same metric
   definition. Cycles whose accuracy sample is `insufficient` are not plotted.
3. **Solving time by cycle** — per-cycle total solving time and the per-puzzle
   average/median, in cycle-number order. Shows the "beat half the previous
   cycle's time" target when a previous cycle exists (guidance, never a gate).
4. **Hints and retries by cycle** — `hintsUsed` / `puzzlesRequiringHint` and
   `retries` / `puzzlesRequiringRetry` per cycle.
5. **Completion rate by cycle** — completed vs skipped puzzles per cycle.
6. **Improvement over previous cycles** — cards for `current` vs `previous`
   `absoluteDelta` (and `relativeDelta` when defined) of accuracy and solving
   time. Deltas are labeled as measured changes only; the Dashboard must not
   claim the training method caused them (`domain/statistics.md`).
7. **Weakest tactical categories** — horizontal bars of `solveRate` per
   category (tactical objective or `blunder`), ranked categories only
   (`n ≥ MIN_SAMPLE_SIZE`); unranked categories shown separately as
   "not enough data".
8. **Repeatedly failed puzzles** — a compact table/list of puzzles failed in
   `≥ 2` distinct cycles (failure count, cycle count, last failed), linked to
   their source game/puzzle view where a route exists. No scheduling language.

### 4. Provenance footer

- Shows the result's `statisticsVersion` and `VersionSummary` (analysis,
  classification, game-phase, detection versions, engine identities) plus the
  `mixedEngineVersions` / `mixedClassificationVersions` flags. A mixed or
  outdated dataset is **labeled**, never silently mixed (ADR-020).
- When the data is `outdated` (older analysis/classification version), the
  footer offers an explanatory note and a link to the Game Library to opt into
  re-analysis; the Dashboard never triggers it.

### Empty, insufficient and not-detected presentation

| State | Card | Chart point | Label |
|---|---|---|---|
| `ok` | value shown | plotted | value + `n = X` |
| `insufficient` | placeholder (value hidden) | gap (not plotted) | "Insufficient data (n = X)" |
| `empty` | placeholder | gap | "No data" |
| `notDetected` | placeholder | gap | "Tactics not scanned" |

- Every value is accompanied by its sample size (`n = X`), adjacent to the
  value or in the tooltip/legend.
- Empty and insufficient states are **explicit** and never replaced by `0`.
- A chart with no plottable points renders its empty/insufficient placeholder
  instead of an empty axis.

---

## Domain behavior (presentation mapping only)

Feature 015 introduces **no new domain rules**. It owns no statistical math,
denominators, thresholds or versions. Any calculation belongs to Feature 014.

Feature 015 may add **pure presentation selectors/formatters** in the
presentation layer (e.g. `src/components/dashboard/` or a
`src/presentation/dashboard/` module). They must be pure, deterministic and
free of statistics:

1. **Aggregate display mapping** — `(Aggregate) => { text, stateLabel, n, hidden }`:
   - `ok` → formatted value + `n`;
   - `insufficient` → value hidden, "Insufficient data (n = X)";
   - `empty` → "No data";
   - `notDetected` → "Tactics not scanned".
2. **Trend → chart points mapping** — `(TrendSeries) => ChartPoint[]` that
   selects `periodKey`/`periodStart`/`periodEnd`, maps `ok` to `value` and
   every other state to a gap (`value: null`), and carries `state`/`n` for the
   tooltip. It preserves one x-axis slot per period (gaps included) and never
   computes a value.
3. **Rating history → chart points mapping** — `(RatingHistory) => ChartPoint[]`
   over the stored points, with no interpolation or carry-forward.
4. **Formatting only** — accuracy via the canonical Feature-009
   `formatAccuracy(value, { decimals: 1 })`, counts as integers, times as
   `mm:ss` / `h:mm:ss`, ratings as integers. Rounding is presentation.
5. **Partition labels** — canonical platform order (Lichess, Chess.com) and
   ADR-013 category names; exact time control shown in `M|I` house style where
   relevant (`domain/time-control.md`). The category is platform-correct, so
   the same raw clock may appear under different category labels on different
   platforms (`5|5`: Lichess Rapid, Chess.com Blitz).

These selectors live in the presentation layer; they must not be added to the
Feature-014 domain modules and must not import React. The `useDashboard` hook
owns the application wiring (query state → statistics service → result), and
the React components render only.

### Query construction

- The hook builds a canonical `StatisticsQuery` from the filter bar:
  `platform`, `timeControl`, `dateRange`, `now` (caller-supplied), with
  `side: 'all'`, `result: 'all'` and no `combine` (never a silent merge).
- One `gameMetrics` read supplies the summary cards; `trendSeries` is called
  per chart metric and `ratingHistories` once; `phaseMetrics` once for the
  phase chart. The training section calls `trainingSetStats`,
  `weakestCategories` and `repeatedlyFailed` for the selected set.
- The hook passes a `dataVersionKey` (a caller/assembler-derived version) so
  Feature 014's memoization is used across re-renders; correctness never
  depends on the cache.

---

## Data requirements

- **No new persisted table and no schema change.** Feature 015 reads through
  the existing Feature-014 service only.
- **One new runtime dependency:** `recharts` (ADR-010), MIT-licensed, at the
  latest stable version per the Dependency policy in `AGENTS.md`; no version
  pin beyond the caret range/lockfile. Recharts is imported via named
  components to keep Vite tree-shaking effective.
- No new storage, sync or worker code. The existing statistics worker is used
  transparently by the service above its row threshold.
- New presentation files: the `/dashboard` page, a `useDashboard` hook and
  Recharts wrapper/chart components under the dashboard component area. The
  DashboardPage placeholder is replaced.
- The route may be lazy-loaded like the other heavy pages if the production
  bundle measurement requires it; that is a plan detail, not a requirement.
- No statistics value is persisted, cached to IndexedDB, or synced by this
  feature.

---

## States

- **Page states**: loading, ready, empty (no games), no-analysis (games but no
  eligible analysis), no-training (no set), load error.
- **Filter states**: default concrete partition, `All` dimensioned view,
  mixed-view label, invalid custom range (inline hint, last valid view kept).
- **Metric states**: `ok`, `insufficient`, `empty`, `notDetected` (Feature 014
  §3), surfaced as the presentation mapping above.
- **Analysis availability**: games present but unanalyzed → analysis charts
  show their empty/insufficient states, never zeros.
- **Training states**: no set; set with no cycles; `inProgress` (partial);
  `completed`; `abandoned` (separate); a cycle with zero definite puzzles
  (`empty` rates/times).
- **Provenance states**: single version, mixed versions, outdated.
- **Theme states**: light, dark (both must render charts legibly).
- **Viewport states**: desktop, tablet, mobile.

---

## Error cases

The Dashboard is read-only and must never crash or fabricate data:

- **Statistics read fails** (`{ ok: false }` or a rejected promise) — the
  affected card/chart shows an inline "Could not load statistics" state with a
  retry; other sections stay usable. The page never shows a fabricated value.
- **Invalid custom date range** — typed validation error from Feature 014;
  the page shows the inline hint and keeps the last valid view.
- **Unknown `normalizedTimeControl`** — bucketed as `unknown` by Feature 014
  and rendered as its own partition; never merged.
- **Missing summary / orphaned rows** — excluded by Feature 014 and surfaced
  only as diagnostics; the Dashboard does not attempt to repair them.
- **No detection pass** — missed-tactic metrics render `notDetected`
  ("Tactics not scanned"), never `0`.
- **No eligible games for a partition** — the partition is not rendered (or
  renders an explicit empty state), never a zero line.
- **Chart render failure** (e.g. malformed series) — an error boundary isolates
  the failing chart; the rest of the page remains.
- **Training set deleted between reads** — the selector refreshes and selects
  the next available set or the empty state.
- **Re-analysis completes between reads** — a consistent Feature-014 snapshot
  is shown; versions reflect the snapshot.
- **Recharts/ResizeObserver unavailable in a test environment** — the test
  setup provides the required stubs (see Testing requirements); production
  browsers all support ResizeObserver.

---

## Edge cases

- **Mixed platform/time control** — dimensioned series with a mixed label; no
  silent merge; `correspondence`/`unknown` always separate.
- **Only one platform / one time control** — a single partition with no
  "mixed" label.
- **A game with `rating: null`** — no rating point; the gap is explained.
- **`playedAt: null`** — excluded from date windows (Feature 014 diagnostics);
  never assigned to an arbitrary period.
- **Trend periods with no games** — explicit gaps, never zeros.
- **ISO week spanning a year** and month/year boundaries — rendered by period
  key; the Dashboard trusts Feature 014's period math.
- **Boundary `n`** — exactly 5 is `ok`; 1–4 is `insufficient`; 0 is `empty`
  (or `notDetected` for missed tactics).
- **A period/cycle at `insufficient`** — not plotted; the axis still shows the
  period.
- **Training set with one puzzle / all-skipped cycle / zero definite puzzles**
  — `empty` rates/times, not `0`.
- **Multiple completed analyses for a game** — Feature 014's eligible-analysis
  rule applies; the Dashboard does not choose.
- **Empty dataset** — a first-run empty state explaining how to import and
  analyze games, with links to Games and Analysis.
- **Long series / many partitions** — bounded rendering (see Performance);
  legends and tooltips remain usable.
- **Very large rating values / long set names** — no clipping of accessible
  text; labels wrap.
- **Dark theme** — chart grid/axis/label colors use theme tokens, not fixed
  dark-on-light defaults.

---

## Accessibility requirements

Charts must be usable without colour, without hover and without a pointer.

- **Text equivalents**: every chart has a visually-hidden (or
  disclosure-revealed) data table or textual summary with the same values,
  states and `n`, so screen-reader and keyboard users get the data. The chart
  itself carries an accessible name/description (`role="img"` + `aria-label`
  naming the metric, partition and granularity).
- **No hover-only information**: tooltips are reachable by keyboard focus and
  by touch tap; the same information is available in the data table.
- **Colour is never the only signal**: series are distinguished by legend text
  and labels as well as colour; error classes keep their canonical
  Feature-009 labels/colours, with text.
- **State is text, not colour**: "Insufficient data (n = X)", "No data",
  "Tactics not scanned", "Partial cycle" are rendered as text.
- **Keyboard**: the filter bar, set selector and chart/tooltip controls are
  reachable and operable by keyboard; no essential action is keyboard-only or
  hover-only.
- **Reduced motion**: `prefers-reduced-motion: reduce` disables Recharts
  animations.
- **Contrast**: chart text/axes and card labels meet WCAG AA in both themes.
- **Live updates**: when filters change, an `aria-live="polite"` region
  announces the new scope/loading state without stealing focus.
- **Focus management**: selecting a filter or set keeps focus and does not
  scroll-jump.

---

## Responsive / mobile requirements

- **Mobile-first stack**: single column; the filter bar wraps; the game-analysis
  and training sections stack. No horizontal page scroll.
- **Fluid charts**: Recharts `<ResponsiveContainer>` fills its card; a sensible
  minimum height is set per chart so it never collapses. Labels/legends wrap or
  shorten rather than overflow.
- **Touch**: tap shows the tooltip/point detail; tap targets are at least
  ~44×44 px; the chart does not rely on hover or precise pointer movement.
- **Tables on mobile**: the repeatedly-failed list and any data table render as
  stacked cards rather than a squeezed table.
- **Partition handling**: when `All` produces many partitions, mobile renders
  one series/partition at a time (e.g. a partition selector or paged cards)
  rather than an unreadable multi-line chart.
- **Performance on mid-range devices**: the page loads progressively (cards
  first, then charts) and never blocks the main thread (see Performance).
- **Orientation**: works in portrait and landscape; chart height adapts.
- **Tablet/desktop**: multi-column card grid; charts may sit side by side at
  sufficient width.

---

## Performance constraints

- **No engine, no network.** All data comes from Feature 014 over persisted
  local data (`ARCHITECTURE.md` §10/§11).
- **No long task on the main thread.** Feature 014 already offloads large
  aggregation to its worker above the row threshold; the Dashboard must not add
  synchronous work over large series. Rendering must stay within the
  interaction budget (no jank while filtering).
- **Default granularity is weekly** for game trends, which bounds the number of
  points; day granularity is available but the page must keep rendering
  bounded (e.g. a maximum plotted window or down-sampling at the presentation
  level only — never changing values).
- **Memoization**: the hook passes a `dataVersionKey` so repeated
  filter/render cycles reuse Feature 014's memoized results; the Dashboard adds
  no second cache that could go stale.
- **Recharts cost**: SVG rendering is acceptable for the bounded V1 point
  counts; charts are imported by named component and code-split with the
  `/dashboard` route if the bundle measurement requires it.
- **Progressive load**: summary cards render from `gameMetrics` first; each
  chart loads independently so one slow read does not block the page.
- **Scale target**: stays usable with thousands of analyzed games and tens of
  thousands of attempts (Feature 014's target); the Dashboard's own budget is
  defined and measured in the implementation plan.

---

## Acceptance criteria

1. The Dashboard renders rating, accuracy, error, missed-tactic, game-phase and
   training information from Feature 014; it performs **no** statistical
   calculation.
2. Every rendered value/card shows its sample size (`n = X`), and every
   aggregate below `MIN_SAMPLE_SIZE = 5` is replaced by an explicit
   "insufficient data" placeholder (charts omit the point).
3. `empty`, real zero and `notDetected` are visually and textually distinct;
   absent data is never shown as `0`.
4. Rapid and Blitz (and every other ADR-013 category) are never silently
   combined; `All` produces explicitly labeled dimensioned views and mixed
   views are never the default; category membership is platform-correct
   (Chess.com `5|5` is Blitz, Lichess `5|5` is Rapid; Chess.com has no
   `classical` partition).
5. Rating lines are always per `(platform, timeControl)`; no cross-platform or
   cross-time-control averaging/conversion.
6. Game-phase charts use the normalized `errorsPer100Moves` by default (counts
   optional) and missed tactics by phase honors detection state.
7. The training section is set-scoped (selected set), never game-filtered, and
   never shows scheduling language; `inProgress` cycles are labeled partial and
   `abandoned` cycles are shown separately.
8. Training charts cover current cycle progress, per-cycle accuracy, solving
   time, hints/retries, completion, cross-cycle deltas, weakest categories and
   repeatedly failed puzzles; deltas are measured changes without causation
   claims.
9. The filter bar reuses the canonical `domain/game-library.md` dimension model
   and URL serialization; a custom range is validated.
10. Version provenance and mixed/outdated labels are surfaced (ADR-020).
11. Light and dark themes both render legibly; charts use theme tokens.
12. The page works on desktop, tablet and mobile with touch; no essential
    information is hover-only.
13. Every chart has an accessible name and a text/data-table equivalent; state
    and series identity are conveyed by text, not colour alone.
14. The page never blocks the main thread or starts Stockfish; reads are
    bounded and memoized through Feature 014.
15. `recharts` is the only new dependency, is MIT-licensed and follows the
    Dependency policy; no version pin is introduced.
16. Component tests run deterministically against an injected fake statistics
    service, with no engine, network or real IndexedDB.

---

## Testing requirements

### Deterministic fixtures / fakes

- Component tests inject a **fake Feature-014 result source** (a stub
  `StatisticsService`-shaped object or a `useDashboard` dependency) so no
  IndexedDB, engine or network is needed. Fixtures cover, at minimum:
  - `ok`, `insufficient` (`n = 4`), `empty` and `notDetected` aggregates;
  - trend series with explicit empty gaps, an `insufficient` point and a
    period-boundary point;
  - two concrete partitions (Lichess + Chess.com, rapid + blitz) proving no
    merge;
  - a per-platform time-control pair (`5|5`) proving Lichess Rapid and
    Chess.com Blitz render as separate partitions and that a Chess.com
    `classical` filter yields an explicit empty state;
  - rating histories with a missing rating and an undated game;
  - phase metrics with differing per-phase move exposure;
  - a training set with an `inProgress`, a `completed` and an `abandoned`
    cycle, an all-skipped cycle, a `insufficient` cycle, weakest categories
    (ranked + unranked) and a repeatedly-failed puzzle;
  - a mixed-version/outdated `VersionSummary`.
- The fakes are separated from production data and are pure/deterministic.

### Test cases

- **No calculation**: a test asserts the Dashboard calls only Feature-014
  methods and never imports/executes domain statistics functions; a snapshot
  of rendered values equals the fake input verbatim (formatting only).
- **Sample size and placeholders**: `n = X` shown for `ok`; value hidden and
  placeholder shown for `insufficient`/`empty`/`notDetected`; a chart does not
  plot an `insufficient` point.
- **No silent merge**: with `platform`/`timeControl` = `All`, two partitions
  render as two labeled series; rapid and blitz values never appear in one
  series; a mixed note is visible.
- **Rating separation**: Lichess and Chess.com rating series are distinct; no
  averaged line exists.
- **Phase semantics**: the default chart uses `errorsPer100Moves`; counts are
  available via the alternate view; missed tactics honors `notDetected`.
- **Training scope**: changing the game filters does not change the training
  charts; changing the set selector does; no "due"/"next review" text exists.
- **Cross-cycle deltas**: `current`/`previous`/`absoluteDelta` match the fake;
  no causation wording is rendered.
- **Provenance**: mixed/outdated flags render their labels.
- **URL state**: filters serialize to and restore from the URL; an invalid
  custom range shows the inline hint and keeps the last valid view.
- **Error handling**: a failed statistics read renders the inline error/retry
  and does not fabricate values; a chart error boundary isolates the failure.
- **Accessibility**: each chart exposes an accessible name and a text/data
  equivalent; tooltips are keyboard- and touch-reachable; `prefers-reduced-
  motion` disables animation; state labels are text.
- **Responsive**: renders at desktop/tablet/mobile widths without overflow;
  touch interaction path is exercised (Playwright where Chromium is available).
- **Themes**: light/dark render with theme tokens; no fixed colours.
- **Test environment**: the test setup stubs `ResizeObserver` (and any
  `window.matchMedia` needs) required by Recharts `<ResponsiveContainer>` under
  happy-dom/jsdom.

### Narrow-first order

Focused dashboard component/selector tests first, then the full gate
(`npm run lint`, `typecheck`, `format:check`, `test`, `build`, `dev`,
`test:browser` when Chromium is available, `npm audit`) per `AGENTS.md`.

---

## Dependencies

Feature 015 depends on:

- Feature 014 — the sole data source (`gameMetrics`, `trendSeries`,
  `ratingHistories`, `phaseMetrics`, `trainingSetStats`, `weakestCategories`,
  `repeatedlyFailed`, `masteredPuzzleCounts` if used).
- Feature 013 — training sets/cycles surfaced by the training selector.
- Feature 009 — `formatAccuracy` and classification labels/colours (reused for
  presentation, not recomputed).
- Feature 004/007 — the canonical `domain/game-library.md` filter/date model
  and URL serialization convention.

Feature 015 is consumed by: none (terminal UI surface).

New dependency: `recharts` (ADR-010), latest stable, MIT, per the Dependency
policy.

---

## Context

Required reading (see `.opencode/CONTEXT-MAP.md`):

- Architecture/decisions: `ARCHITECTURE.md` §6a; `decisions/ADR-010`,
  `decisions/ADR-013`, `decisions/ADR-023`, `decisions/ADR-024`,
  `decisions/ADR-031`
- Domain: `domain/statistics.md`, `domain/tactical-training.md`,
  `domain/game-model.md`, `domain/game-library.md`
- Research: `research/charting-library.md`

Feature dependencies: Feature 014 (sole read-only data source), Feature 013
(training data), Feature 009 (accuracy/classification formatting), Feature
004/007 (canonical filter/date model).
