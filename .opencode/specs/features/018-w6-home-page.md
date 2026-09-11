# Feature 018 — W6 Home Page

> Cross-cutting UI workstream, not a new product capability. It turns the
> application entry point (`/`) into a real **Home** page that orients a new
> user and gives a returning user a start/continue entry point. It **composes**
> existing surfaces — the Game Library (007/008), Training (011–013) and
> Statistics (014/015) — and introduces **no new domain rule, no new persisted
> table, no new dependency and no ADR**. Every statistic it shows is produced by
> Feature 014 and consumed read-only.

## Purpose

The current `/` route is a hero-only placeholder (`src/pages/HomePage.tsx`)
with a static "Get started" link. It does not tell the user what the app does,
what state their data is in, or where to go next.

This feature makes `/` the product's front door:

- it **orients** a first-run user with short "how it works" copy and a primary
  action that starts the workflow (import → analyze → train);
- it gives a returning user a **"continue where you left off"** entry point
  (an in-progress training cycle, else the open block, else the most recent
  set);
- it surfaces a few **key at-a-glance statistics** sourced from Feature 014,
  always with the honest-state contract (`ok` / `insufficient` / `empty` /
  `notDetected`, `n`, absent ≠ zero);
- it provides **quick navigation** to Games, Training, Statistics and Analysis;
- it stays **light**: no charts in the initial bundle, no engine, no network,
  no heavy synchronous work on the home path.

The Home page is a **presentation/composition surface**. It renders no chart
(the Statistics page owns charts) and performs no statistics, classification,
accuracy, cycle-metric or mastery calculation of its own.

---

## Scope

### In scope

1. The `/` page (index route inside the Feature 001 `AppShell`) rebuilt as a
   Home landing page with the regions below.
2. A context-aware **hero / primary action** that adapts to the user's data
   state.
3. A **continue** card resolving to the most relevant training target.
4. **At-a-glance stat cards** sourced from Feature 014 (and the canonical
   Feature 013 mastery derivation for the mastered count), using the
   honest-state display mapping.
5. **Quick navigation** links/buttons to Games, Training, Statistics and
   Analysis.
6. Short **"how it works / where to start"** explanatory copy.
7. Explicit **first-run** and **returning** states.
8. A thin `useHome` hook plus pure presentation selectors under
   `src/presentation/home/` (no React in the selectors).
9. Deterministic component tests against injected fake statistics/repository
   sources.

### Out of scope

- Any statistics computation, aggregation, classification, accuracy, phase,
  cycle-metric or mastery logic (Feature 014 / Feature 013 own it; Home reuses
  it verbatim).
- Any engine work, analysis, detection, puzzle generation, import, or network.
- Any mutation: Home is read-only (no start/abandon/delete; the continue link
  navigates to the existing host page which owns the action).
- Charts and the Recharts bundle on the initial route (see Performance).
- A materialized statistics cache or any new persisted table.
- Individual-puzzle scheduling, "due"/"retention" concepts (ADR-031).
- Redesigning the Statistics page, the Training home, the Game Library or the
  header/nav beyond the links Home adds.
- New dependencies, a new ADR or a schema change.

---

## Relationship to other features

| Feature     | Role                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001         | App shell, theme, navigation, `ROUTES`; Home is the index route inside it.                                                                          |
| 007         | Game Library destination for import/analysis and the canonical game count.                                                                          |
| 008         | Analysis destination; the analysis status behind "games analyzed".                                                                                  |
| 009         | Canonical accuracy/classification formatting reused for display.                                                                                    |
| 011/012/013 | Puzzles, immutable attempts, training sets/cycles and the canonical mastery derivation.                                                             |
| 014         | **Sole source of game statistics and the mastered-puzzle read model** (`gameMetrics`, `trainingSetStats`).                                          |
| 015         | The Statistics page Home links to; owns charts and the full filtered view.                                                                          |
| 017 (W1)    | Section naming/routes ("Training", "Statistics") and nav order Home, Games, Training, Statistics, Analysis, Settings. W6 follows the post-W1 names. |

Home never duplicates a value Feature 014/015 already produces, and the
Statistics page remains the place for filtered, multi-partition, charted
analysis.

---

## User-facing behavior

The page is a single responsive column (desktop: a centered content column with
a card grid) composed of five regions in order:

1. **Hero / primary action**
2. **Continue** card
3. **At-a-glance stats** grid
4. **Quick navigation** links
5. **How it works / where to start** copy

The regions after the hero are loaded progressively (see Performance): the hero,
quick navigation and explanatory copy render immediately; the continue card and
the stat cards render from independently-loading data slices.

### 1. Hero / primary action

- The hero keeps the product name and a one-sentence value statement (reusing
  the existing `Hero` component or an equivalent header).
- The **primary action is context-aware** (a deterministic presentation
  selection, §"Domain behavior"):
  - no games stored → **"Import your games"** → the Game Library (`ROUTES.games`);
  - games stored but none with an eligible analysis → **"Analyze a game"** →
    the Game Library (`ROUTES.games`);
  - a resumable training target exists → **"Continue training"** → the resolved
    continue target (cycle session or set detail);
  - otherwise (games analyzed, no training target) → **"View your statistics"**
    → the Statistics page (`ROUTES.dashboard`, renamed `/statistics` by W1).
- A secondary action is always present: **"Open the Game Library"** →
  `ROUTES.games`. The hero never relies on hover and both actions are real
  links or buttons.
- The hero is **not** a marketing surface: it states what the app does
  (analyze your own games, turn mistakes into puzzles, train in cycles, all
  local) in one or two sentences.

### 2. Continue card

- Shown only when a continue target resolves (returning user); hidden in the
  first-run state.
- The card names the target and links to it:
  - an **in-progress cycle** → the cycle session
    (`puzzlesCyclePath(setId, cycleNumber)`), labeled with the set name and
    cycle number, or **"Quick train"** for the reserved ad-hoc sentinel;
  - else the **open Woodpecker block** → its set detail
    (`puzzlesSetPath(setId)`), inviting the next cycle;
  - else the **most recently active custom set** → its set detail.
- The card includes a short line of status text (e.g. "Cycle 2 in progress —
  pick up at the next unanswered puzzle") and never shows a fabricated
  progress number; if progress is shown it comes from Feature 014 (see stats)
  or the canonical cycle row, never a re-derived value.
- The card is a landmark region with an accessible name ("Continue training")
  and a single clear link.

### 3. At-a-glance stats

Four headline cards, each honest and labeled. The game-analysis cards are
scoped to the **primary partition** (the concrete `(platform, timeControl)`
with the most games in the recent window; §"Domain behavior") and the recent
window, and say so on the card. If no partition exists, the card shows an
explicit empty state, never a zero.

| Card                 | Source                                                                     | Presentation                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Games analyzed**   | primary partition `metrics.games.analyzed` / `metrics.games.total`         | "12 of 30 analyzed" + partition/window label; no partition → "No recent games".                                                           |
| **Accuracy**         | primary partition `metrics.accuracy` (`Aggregate`)                         | value + `n` via the Feature 015 `aggregateDisplay` mapping; `insufficient` → "Insufficient data (n = X)", `empty` → "No data".            |
| **Puzzles mastered** | canonical Feature 013 `masteredPuzzleIds(attempts, cycles)`                | "M of P puzzles mastered"; no puzzles → "No puzzles yet"; never a bare `0` when no puzzles exist.                                         |
| **Current block**    | open block `trainingSetStats(blockId).currentCycle` (`CycleStats.metrics`) | "Cycle N · C of S puzzles done" with the cycle status; no open block → "No open block" linking to Training; `inProgress` labeled partial. |

- **Recommended secondary cards** (shown when the data is present, in this
  order, bounded to at most two): **Blunders per game** (primary partition
  `classification.blundersPerGame` `Aggregate`) and **Missed tactics per game**
  (primary partition `missedTactics.missedTacticsPerGame`, which renders
  "Tactics not scanned" for `notDetected`).
- **Every computed aggregate** is rendered through the Feature 015
  `aggregateDisplay` / `formatAccuracyDisplay` / `formatSample` helpers. The
  Home page adds no new display state, placeholder text or rounding rule.
- **Counts** (games analyzed, mastered puzzles) use `formatCount`; they are
  honest counts whose only "absent" state is "no data at all" (no games / no
  puzzles), stated in words.
- No card renders a chart, sparkline or trend line. "Recent" is expressed by
  the window label, not by a delta the page computes (Feature 014 computes
  deltas; Home does not).

### 4. Quick navigation

A compact row/grid of links (real anchors, keyboard and touch reachable):

- **Games** → `ROUTES.games`
- **Training** → `ROUTES.puzzles` (renamed `/training` by W1)
- **Statistics** → `ROUTES.dashboard` (renamed `/statistics` by W1)
- **Analysis** → `ROUTES.analysisLive`

Each link carries an icon/glyph where the nav already uses one and has a
visible text label (never icon-only). Labels follow the W1 section names.

### 5. How it works / where to start

Short, static explanatory copy (2–4 sentences or a small ordered list):

1. **Import** your own games from Lichess or Chess.com.
2. **Analyze** them locally with Stockfish to find mistakes and missed tactics.
3. **Train** the puzzles generated from those games in fixed cycles.
4. Everything is stored on this device; synchronization is optional.

The copy includes at least one link to the Game Library and one to Training so
a new user can start without reading the whole page.

### First-run vs returning state

- **First-run** (no games): the primary action is "Import your games"; the
  continue card is absent; the stat cards are replaced by a single explicit
  "No games yet" state that explains the workflow and links to the Game
  Library; the how-it-works copy is shown in full.
- **Games, no analysis**: the primary action is "Analyze a game"; the stats
  cards show the analyzed/accuracy states explicitly ("No analyses yet"), never
  zeros; the continue card is absent (no training target yet) unless a set
  exists.
- **Returning** (analysis and/or training data): the primary action is
  "Continue training" when a target resolves, else "View your statistics"; the
  continue card and stat cards are shown; the how-it-works copy may be
  collapsed behind a disclosure.

---

## Domain behavior

Home adds **no domain rule**. It owns only deterministic **composition and
selection** rules, implemented as pure presentation selectors under
`src/presentation/home/` (no React, no Dexie, no statistics computation).

### 1. Continue resolution

`resolveHomeContinue(input)` is a pure selector. Inputs are the persisted
training rows Home already reads: the active/archived sets, the single open
block, and every persisted cycle (including the reserved Quick-train sentinel).
It returns exactly one of:

1. **`cycle`** — the `inProgress` cycle with the greatest `startedAt`
   (tie-break: greater `cycleNumber`, then `cycleId` ascending). The set name is
   the owning set's name, or **"Quick train"** when `trainingSetId` is
   `QUICK_TRAIN_SET_ID`. This includes Quick-train cycles, which the current
   `TrainingHomePage` resume banner excludes; Home surfaces them (recommended,
   owner-confirmable).
2. **`block`** — else the single open Woodpecker block, if one exists.
3. **`set`** — else the most recently active custom set (greatest `updatedAt`,
   then `createdAt`, then id ascending — the existing Feature 015
   `selectDefaultTrainingSet` recency order).
4. **`none`** — else no continue target (first-run / no training data).

The selector is deterministic for a fixed input and never picks an `abandoned`
or `completed` cycle as "continue".

### 2. Primary partition selection

`selectPrimaryPartition(partitions)` is a pure selector over the Feature 014
`gameMetrics` partitions. It returns the partition with the greatest
`metrics.games.total`; ties keep the **canonical order** Feature 014 already
returns (platform: Lichess, Chess.com, local; then ADR-013 category order). It
never merges two partitions and never computes an average across partitions.

This mirrors the W1 "busiest concrete partition" default for the Statistics
page and keeps the Home cards honest: accuracy and error rates are always shown
for one labeled `(platform, timeControl)` partition.

### 3. Primary action selection

`selectHomePrimaryAction(state)` is a pure selector over the loaded state
(counts, continue target) returning the hero action described above. It reads
only existing values (`games.total`/`games.analyzed`, the continue target) and
computes nothing.

### 4. Mastery reuse

The "puzzles mastered" value is the canonical Feature 013
`masteredPuzzleIds(attempts, cycles)` derivation — the same function the
Training home pool and the Mastered-puzzles page use. Home never re-implements
mastery and never writes it. When the open block exists, the block card may
additionally use Feature 014's `masteredPuzzleCountForSet(block, attempts,
cycles)` (`Aggregate`); Home does not add a global mastered aggregate.

### 5. No new math

No selector performs statistics math. Sums, averages, medians, rates, deltas,
normalization, period math, classification, accuracy and mastery all remain in
Feature 014 / Feature 013. A value the Home page could compute is a defect: it
must come from Feature 014 (aggregates/counts), Feature 013 (mastery/cycle
identity), or a repository count.

---

## Data requirements

- **No new persisted table and no schema change.** The schema stays at its
  current version (see "Conflicts, ambiguities & ADR assessment"); Home is
  read-only and derives everything on demand.
- Reads (all existing, read-only):
  - `gamesRepository.countGames()` — total stored games (Feature 007);
  - `getBrowserStatisticsService().gameMetrics(query)` — one call over
    `platform:'all'`, `timeControl:'all'`, `side:'all'`, `result:'all'`, the
    recent window and the caller-supplied `now`; returns the dimensioned
    partitions Home selects from (no `combine`);
  - `getBrowserStatisticsService().trainingSetStats(blockId)` — the open
    block's current cycle progress (Feature 014 over Feature 013 rows);
  - `trainingSetsRepository.list(...)` / `.getOpenBlock()` — active/archived
    sets and the single open block (Feature 013);
  - `trainingCyclesRepository.listAll()` — in-progress cycle resolution;
  - `puzzlesRepository.listAll()` and `attemptsRepository.listAll()` — the
    canonical mastery input and the total puzzle count (deferred slice; see
    Performance).
- **Query window.** The Home game-analysis query uses a bounded recent window
  (`HOME_STATS_WINDOW = 'last3m'`, presentation constant) so the entry page
  never scans all history. The card labels the window. When the recent window
  yields no partition, the card states "No recent games" and links to the
  Statistics page; the window is **never silently widened**.
- **No `combine`.** Home never requests a merged partition; it selects one
  concrete partition. A global "games analyzed" total across partitions is
  therefore **not** produced here (see ambiguities).
- **Loading / empty / error contract.** Each data slice has
  `{ data, loading, error }` (the `useDashboard` pattern). Slices load
  independently: one failed read never blanks another region, and every region
  renders its own explicit loading, empty or error state. The page never
  fabricates a value and never renders absent data as `0`.
- **No worker or engine is started by Home.** Feature 014's service offloads
  large aggregation to its existing worker transparently; Home adds no worker.
- **Lazy code path.** The statistics service and the data-driven regions are
  loaded behind a dynamic import so the initial route bundle does not pull in
  the statistics service, the Recharts bundle or the engine. No statistics
  value is persisted, cached to IndexedDB or synced.

---

## States

- **Page states**: loading (hero/static regions visible, data regions in a
  skeleton with `aria-busy`), ready, first-run (no games), no-analysis (games
  but no eligible analysis), no-puzzles (games/analysis but no puzzles), no
  training target, load error.
- **Continue states**: `cycle` (in-progress, incl. Quick train), `block` (open
  block, no cycle), `set` (most recent set), `none`.
- **Metric states**: `ok`, `insufficient`, `empty`, `notDetected` (Feature 014
  §3), surfaced through the Feature 015 display mapping; counts show an
  explicit "no data" wording rather than `0` when the source is absent.
- **Training states**: no sets; open block with no cycle; `inProgress` cycle
  (partial); `completed`; `abandoned` (never shown as "continue"); all puzzles
  mastered.
- **Analysis availability**: games present but unanalyzed → the analysis cards
  show "No analyses yet", never zeros.
- **Theme states**: light and dark both render the cards/links legibly.
- **Viewport states**: desktop, tablet, mobile.

---

## Error cases

Home is read-only and must never crash or fabricate data:

- **Statistics read fails** (`{ ok: false }` or a rejected promise) — the
  affected card/region shows an inline "Could not load statistics" state with a
  retry; the hero, quick navigation and other regions stay usable.
- **Training read fails** — the continue card and block card show an inline
  error/retry; the game-analysis cards are unaffected.
- **No open block** — the block card shows "No open block" with a link to
  Training, never a fabricated cycle.
- **No in-progress cycle** — the continue card falls through to the open block
  or most recent set; it never invents a cycle.
- **Quick-train sentinel** — rendered as "Quick train" (no set row exists); the
  sentinel is never looked up as a normal set.
- **A set/cycle deleted between reads** — the affected slice refreshes and
  re-resolves; a vanished target is dropped, never rendered stale.
- **Invalid query** — impossible for Home's fixed query (no custom range);
  Feature 014's typed error is still handled by the slice error path.
- **Chart/test environment** — Home renders no chart, so no ResizeObserver or
  Recharts stubs are required for its tests.
- **Lazy chunk fails to load** — the data regions show the inline error/retry;
  the static regions remain.

---

## Edge cases

- **Zero games** — first-run hero and a single "No games yet" state; no zeros.
- **Games but no analysis** — analysis cards show "No analyses yet"; the
  primary action is "Analyze a game".
- **Only one partition** — that partition is primary; no "mixed" label needed.
- **No partition in the recent window** — "No recent games" with a link to
  Statistics; the window is not widened.
- **Exactly `MIN_SAMPLE_SIZE`** — `n = 5` is `ok`; `1–4` is `insufficient`; `0`
  is `empty` (`notDetected` for missed tactics). Home only renders the state
  Feature 014 returns.
- **No puzzles / all puzzles mastered** — "No puzzles yet" vs
  "M of P mastered"; the block card is independent.
- **Open block with no cycles yet** — the block card shows "Not started" (or
  "Cycle 1 not started"), never `0 of S`.
- **In-progress cycle mid-analysis or with skipped puzzles** — progress uses
  the Feature 014 `CycleStats.metrics` (`puzzlesCompleted` of the snapshot
  size); skipped is not counted as completed.
- **Multiple in-progress cycles** — the most recently started wins (the
  deterministic continue rule).
- **Quick-train cycle in progress** — surfaced as "Quick train" (recommended;
  the current Training resume banner omits it).
- **All-mastered pool** — the block card may say the pool is empty; the
  mastered count is at its maximum; no action is fabricated.
- **Large data** — the mastery read and statistics aggregation are deferred and
  bounded/worker-backed (Performance); the page never blocks on them.
- **Missing ratings / undated games** — they do not affect the counts or
  accuracy shown; Home shows no rating card in V1 (recommended secondary card
  only if a rating point exists).
- **Very long set names / large numbers** — labels wrap; numbers use
  `formatCount`; no clipping of accessible text.
- **Dark theme** — card/link colors use theme tokens.

---

## Accessibility requirements

- **Landmarks and headings**: one `<h1>` (hero), the continue card is a named
  `<section>` (e.g. `aria-label="Continue training"`), stats are a `<dl>` or
  named list, quick navigation is a `<nav aria-label="Quick links">`.
- **Text equivalents**: every stat value and its state/`n` are text (via the
  Feature 015 mapping); color is never the only signal.
- **No hover-only information**: all links/actions are real anchors/buttons
  reachable and operable by keyboard and touch; nothing essential is revealed
  only on hover.
- **Focus and live updates**: the lazily-loaded regions use
  `aria-busy`/`aria-live="polite"` for the loading→ready transition without
  stealing focus; focus is not moved on load.
- **Contrast**: card text, labels and links meet WCAG AA in both themes.
- **Reduced motion**: any loading animation respects
  `prefers-reduced-motion: reduce`.
- **Icon links** keep an accessible name from visible text (never icon-only).
- **Skip link**: Home sits inside the shell's existing skip-to-content
  behavior; it adds no focus trap.

---

## Responsive / mobile requirements

- **Mobile-first single column**: hero, continue card, stat cards, quick links
  and copy stack; no horizontal page scroll.
- **Stat cards** use a responsive grid (1 column mobile, 2 tablet, up to 4
  desktop) with a minimum card height so they never collapse.
- **Touch targets** are at least ~44×44 px; quick links wrap rather than
  overflow.
- **No table** is used; the block progress is a card, not a squeezed table.
- **Orientation** works in portrait and landscape.
- **Progressive load**: the hero and navigation are usable before the stats
  arrive on a slow/mid-range device.
- **Theme**: both themes legible at every breakpoint.

---

## Performance constraints

- **No engine, no network.** All data comes from local persisted rows through
  Feature 014 / Feature 013 (ARCHITECTURE §10/§11).
- **No heavy work on the initial path.** The hero, quick navigation and
  explanatory copy render without waiting on data. The continue card and stat
  cards load from a **dynamically imported** section; the statistics service is
  not in the initial route bundle.
- **No Recharts in the initial bundle.** Home renders no chart. If a future
  visual is added it must be lazy-loaded and must not change the initial
  bundle budget.
- **Bounded reads.** One `gameMetrics` call over the recent window, one
  `trainingSetStats` for the open block, and the small set/cycle reads. The
  mastery read (`puzzlesRepository.listAll()` + `attemptsRepository.listAll()`)
  is part of the deferred slice, not the first paint.
- **No long task.** No single synchronous task may exceed the long-task
  threshold (≈50 ms); Feature 014's worker handles large aggregation. Building
  the mastery `Set` is linear in attempts and must stay within the budget (the
  plan records the measured thresholds); if it does not, the mastered card
  degrades to a deferred/lazy read rather than blocking.
- **No second cache.** Home adds no cache that could go stale; Feature 014's
  `dataVersionKey` memoization is reused by the hook.
- **Scale target.** Stays usable with thousands of games and tens of thousands
  of attempts (Feature 014's target); the Home budget is defined and measured
  in the implementation plan.

---

## Acceptance criteria

1. `/` renders a Home page with the five regions (hero/primary action,
   continue, stats, quick navigation, how-it-works) inside the existing shell,
   replacing the hero-only placeholder.
2. The primary action is context-aware (import / analyze / continue /
   statistics) and both hero actions are real links/buttons.
3. The continue card resolves deterministically to the most recent in-progress
   cycle, else the open block, else the most recent set, else is hidden; a
   Quick-train cycle is surfaced as "Quick train".
4. The stat cards show games analyzed (primary partition counts), accuracy
   (Feature 014 `Aggregate`), puzzles mastered (canonical Feature 013 mastery)
   and current block progress (Feature 014 `trainingSetStats`); the primary
   partition is the busiest concrete partition, never a merge.
5. Every computed aggregate uses the Feature 014 honest-state contract and the
   Feature 015 display mapping; `insufficient` / `empty` / `notDetected` are
   explicit and absent data is never rendered as `0`.
6. The recent window is labeled; when it yields no partition the card states
   "No recent games" and never widens silently.
7. Quick navigation links reach Games, Training, Statistics and Analysis with
   the W1 labels.
8. The first-run, no-analysis and returning states are distinct and correct.
9. Home performs **no** statistics/classification/accuracy/cycle/mastery
   calculation; a test asserts it calls only Feature 014 / Feature 013 /
   repository reads.
10. Home starts no engine and makes no network request; reads are local.
11. The initial route bundle does not include Recharts, the statistics service
    or the engine; the data regions are code-split and load progressively.
12. Light and dark themes render legibly; the layout works on desktop, tablet
    and mobile with touch; no essential information is hover-only.
13. The page has a single `<h1>`, named regions and an accessible continue
    link; async regions announce loading politely.
14. Component tests run deterministically against injected fakes with no
    engine, network or real IndexedDB.
15. No new dependency, no ADR and no schema change.

---

## Testing requirements

### Deterministic fixtures / fakes

- Component tests inject a **fake Feature-014 result source** (a stub
  `StatisticsService`-shaped object, as `useDashboard` uses) and fake
  training/puzzle/attempt repositories; no IndexedDB, engine or network.
- Fixtures cover, at minimum:
  - first-run (no games, no sets, no puzzles);
  - games but no eligible analysis;
  - one concrete partition (`ok` accuracy with `n ≥ 5`);
  - an `insufficient` aggregate (`n = 4`), an `empty` aggregate and a
    `notDetected` missed-tactic aggregate;
  - two concrete partitions (`5|5` Lichess Rapid + Chess.com Blitz) proving the
    primary partition is a single labeled partition and never merged;
  - an in-progress cycle, an open block without a cycle, a most-recent set with
    no cycle, and no target;
  - a Quick-train in-progress cycle;
  - an open block with a partial `inProgress` cycle and one with no cycles;
  - no puzzles, some puzzles mastered, and all puzzles mastered;
  - a failed statistics slice and a failed training slice (independent
    errors).
- Fakes are pure and deterministic, separated from production data.

### Test cases

- **No calculation**: a test asserts the page calls only Feature-014 methods,
  the canonical Feature-013 mastery function and repository reads, and imports
  no domain statistics function.
- **Primary action**: each data state selects the expected hero action and
  target.
- **Continue resolution**: deterministic across multiple in-progress cycles,
  open block, most recent set and no target; Quick train labeled correctly;
  `abandoned`/`completed` cycles never chosen.
- **Primary partition**: the busiest partition wins; ties keep canonical order;
  no merged series is rendered.
- **Honest states**: `n = X` shown for `ok`; the value hidden and the explicit
  placeholder shown for `insufficient`/`empty`/`notDetected`; absent data never
  rendered as `0`.
- **Window**: "No recent games" when the window has no partition; the window is
  labeled.
- **Mastery**: the mastered count equals the canonical `masteredPuzzleIds`
  fixture; "No puzzles yet" when there are none.
- **Block progress**: "Not started" with no cycle; partial `inProgress` labeled;
  `completed`/`abandoned` handled.
- **Quick links**: the four links resolve to the expected `ROUTES` targets.
- **Error handling**: a failed slice renders the inline error/retry and does
  not fabricate values; other regions remain.
- **Accessibility**: single `<h1>`, named regions, keyboard-reachable links,
  text state labels, `aria-busy`/live region on load.
- **Responsive**: renders at desktop/tablet/mobile widths without overflow
  (Playwright where Chromium is available).
- **Themes**: light/dark use theme tokens.
- **Bundle/performance**: a build assertion (or documented measurement) that
  the initial route chunk does not contain Recharts, the statistics service or
  the engine; the data section is a separate chunk.

### Narrow-first order

Focused selector and component tests first, then the full gate (`npm run lint`,
`typecheck`, `format:check`, `test`, `build`, `dev`, `test:browser` when
Chromium is available, `npm audit`) per `AGENTS.md`.

---

## Dependencies

Feature 018 depends on:

- Feature 001 — shell, theme, navigation and `ROUTES` (Home is the index route).
- Feature 007 — Game Library destination and the stored-game count.
- Feature 008 — analysis status behind "games analyzed".
- Feature 011/012/013 — puzzles, attempts, sets/cycles and the canonical
  mastery derivation.
- Feature 014 — the sole source of game statistics and set statistics.
- Feature 015 — the Statistics page Home links to, and the honest-state
  presentation helpers (`aggregateDisplay`, `formatAccuracyDisplay`,
  `formatSample`, `partitionLabel`, `selectDefaultTrainingSet`).
- Feature 017 (W1) — section names/routes ("Training", "Statistics") and nav
  order.

Feature 018 is consumed by: none (an entry surface).

No new dependency, no ADR, no schema change.

---

## Conflicts, ambiguities & ADR assessment

### Conflicts with existing specs

1. **`HomePage` is a hero-only placeholder.** This feature replaces it; the
   existing `Hero` component may be reused but the static "Get started" action
   is superseded by the context-aware primary action.
2. **Feature 013's `TrainingHomePage` resume banner excludes Quick-train
   cycles** (its `loadHome` iterates custom/archived/open-block sets only). Home
   surfaces an in-progress Quick-train cycle (recommended). This is a
   presentation difference, not a domain change; a follow-up Feature 013
   alignment is optional.
3. **Feature 017 (W1) renames "Puzzles" → "Training" and "Dashboard" →
   "Statistics"** with new route paths. This spec is written against the
   post-W1 names and uses `ROUTES` constants; if W6 ships before W1, the labels
   follow the current names. No semantic conflict.
4. **Feature 015 forbids the Dashboard from calculating.** Home adopts the
   same rule. It selects a primary partition rather than summing/merging, so no
   Feature-014 result is recomputed.

### Ambiguities resolved with a recommended default

1. **Global "games analyzed" total.** Feature 014's `gameMetrics` partitions
   with `speedSensitive` metric class and never returns a combined activity
   partition (even though the anti-combination rule permits combining pure
   activity counts when explicitly requested). Recommended: Home shows the
   **primary partition's** counts and leaves the multi-partition/global view to
   the Statistics page. If the owner wants a global total on Home, that is a
   Feature-014 combined-activity read, not a Home calculation.
2. **Recent window.** Recommended `last3m` as the bounded default
   (`HOME_STATS_WINDOW`); "No recent games" when empty. Alternative: `all`
   (heavier; only with the worker path) or `lastYear`.
3. **Global mastered count.** Feature 014 exposes per-game and per-set mastered
   aggregates, not a global one. Recommended: reuse the canonical Feature 013
   `masteredPuzzleIds` for the global count (the Mastered-puzzles page does the
   same). Alternative: add a Feature-014 global mastered aggregate (a Feature
   014 change, not part of W6).
4. **Charts on Home.** Recommended: **no chart** (cards only) to protect the
   initial bundle and keep the Statistics page the chart surface. A future
   small trend chart must be lazy-loaded.
5. **Quick-train continue.** Recommended: include it, labeled "Quick train".
   Alternative: match the current Training resume banner and exclude it.
6. **How-it-works copy.** Recommended: always visible for first-run, collapsible
   for returning users. Exact copy is an implementation detail.

### ADR assessment

**No new ADR is required.** Every decision is presentation, routing or
composition:

- Home renders existing Feature 014/013 values read-only; no statistics,
  classification, accuracy, cycle or mastery semantics change (ADR-024,
  ADR-031 untouched).
- No new dependency (ADR-002/014, ADR-010 and the Dependency policy are
  untouched); Recharts is not imported on Home.
- No persistence/schema change (ADR-001, ARCHITECTURE §7); Home is read-only.
- The recent-window and primary-partition choices are presentation defaults,
  not domain rules.

### Pre-existing observation (not caused by W6)

The working-tree `ARCHITECTURE.md` and ADR-013 describe a **schema v11**
time-control re-normalization, while the implementation is at Dexie v10 /
`PERSISTENCE_SCHEMA_VERSION = 10` and the Feature 014 plan states the version
stays 10. This is an in-flight documentation/implementation discrepancy
unrelated to W6. W6 requires **no** schema change regardless; the conflict
should be resolved by the v11 workstream, not here.

---

## Context

Required reading (paths only; see `.opencode/CONTEXT-MAP.md`):

- `AGENTS.md`
- `.opencode/DECISIONS.md`
- `.opencode/specs/PRODUCT.md` (§2 V1 goal, §12 dashboard, §13 responsive, §14 themes)
- `.opencode/specs/ARCHITECTURE.md` (§3 layers, §6a analytics, §7 storage, §10 performance)
- `.opencode/specs/features/001-foundation.md`
- `.opencode/specs/features/007-game-import.md`
- `.opencode/specs/features/008-game-analysis.md`
- `.opencode/specs/features/013-tactical-training-cycles.md`
- `.opencode/specs/features/014-game-history-statistics.md`
- `.opencode/specs/features/015-dashboard.md`
- `.opencode/specs/features/017-w1-ui-ux-refinements.md`
- `.opencode/specs/domain/game-library.md`
- `.opencode/specs/domain/statistics.md`
- `.opencode/specs/domain/tactical-training.md`
- `.opencode/specs/decisions/ADR-001-local-first.md`
- `.opencode/specs/decisions/ADR-010-charting-library.md`
- `.opencode/specs/decisions/ADR-013-time-control-categories.md`
- `.opencode/specs/decisions/ADR-031-tactical-training-cycles.md`
