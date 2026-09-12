# Plan 018 — W6 Home Page

> Implementation plan for Feature 018 (`features/018-w6-home-page.md`).
> **Plan only — no application code, no tests, no commit in this task.**
> This plan assumes **Feature 017 (W1) lands first** (see §0). It introduces no
> domain rule, no schema change, no dependency and no ADR.

## 0. Prerequisite / dependency (W1)

Feature 018 is written against the post-W1 vocabulary and **must be implemented
after W1 (Feature 017)**:

| W1 change (spec `017-w1-ui-ux-refinements.md` §2) | Home uses |
| ------------------------------------------------- | --------- |
| `ROUTES.puzzles` → `ROUTES.training` (`/training`) | quick nav, "no open block" link |
| `ROUTES.dashboard` → `ROUTES.statistics` (`/statistics`) | primary action "View your statistics", "No recent games" link |
| `puzzlesSetPath` → `trainingSetPath` | continue card (block/set) |
| `puzzlesCyclePath` → `trainingCyclePath` | continue card (cycle), Quick train |
| `DashboardPage` → `StatisticsPage` | link target only |
| `presentation/dashboard/selection.ts` gains `selectDefaultPartition` (combined=false, non-fixture, most games) | Home's `selectPrimaryPartition` mirrors the same "busiest concrete partition" rule |

If W1 has **not** landed at implementation time, either wait, or use the current
names (`ROUTES.puzzles`/`ROUTES.dashboard`, `puzzlesSetPath`/`puzzlesCyclePath`)
as a temporary mapping and convert in the same change W1 lands. Do **not** keep
both names. Stage 0 gates this.

Reference: `.opencode/plans/017-w1-ui-ux-refinements.md:151-212,311-338`.

## 1. Objective

Replace the hero-only `/` placeholder (`src/pages/HomePage.tsx:1-15`) with a
real Home landing page that:

- orients a first-run user with "how it works" copy and a context-aware primary
  action (import → analyze → train);
- gives a returning user a deterministic "continue where you left off" entry
  point (most recent `inProgress` cycle incl. the Quick-train sentinel → open
  block → most recently active custom set → none);
- shows four honest at-a-glance stat cards sourced read-only from Feature 014
  (and the canonical Feature 013 `masteredPuzzleIds` for the mastered count),
  scoped to the busiest concrete `(platform, timeControl)` partition and the
  bounded `last3m` window;
- offers quick navigation to Games, Training, Statistics and Analysis;
- stays light: no chart, no engine, no network, no statistics math, and the
  statistics service/data regions are dynamically imported.

Home is a **composition/presentation surface**. It performs no statistics,
classification, accuracy, cycle-metric or mastery calculation of its own.

## 2. Scope

### In scope

- Rebuild `/` (the index route inside the Feature 001 `AppShell`) with the five
  regions: hero/primary action, continue card, at-a-glance stats, quick
  navigation, how-it-works.
- Pure presentation selectors under `src/presentation/home/`
  (`resolveHomeContinue`, `selectPrimaryPartition`, `selectHomePrimaryAction`)
  and the `HOME_STATS_WINDOW` constant.
- A thin `useHome` hook with independent `{ data, loading, error }` slices and
  an injectable data source (tests use a fake; production uses a dynamically
  imported browser adapter).
- Deterministic component/selector tests with injected fakes; no engine,
  network or IndexedDB.

### Out of scope

- Any statistics/classification/accuracy/cycle/mastery computation, any engine,
  import, detection, puzzle generation or network.
- Any mutation (Home is read-only).
- Charts/Recharts in the initial route.
- A materialized cache or new persisted table.
- Individual-puzzle scheduling / "due" concepts (ADR-031).
- Redesigning Statistics, Training, Game Library, the header/nav, or the
  existing `Hero` component beyond Home's own hero.
- New dependencies, ADR or schema change.

## 3. Existing code to reuse (anchors)

**Routes / shell**

- `src/app/routes.ts:3-17` (`ROUTES`), `:21-36` (`trainingSetPath` /
  `trainingCyclePath` post-W1), `:45-52` (`NAV_ITEMS`).
- `src/app/router.tsx:5` (static `HomePage` import), `:56-61` (index route).
- `src/components/layout/AppShell.tsx:20` (`<main id="main-content">`).
- `src/components/ui/Hero.tsx:1-36` (existing header; not reused directly —
  Home needs a context-aware action row, so an equivalent `HomeHero` is added).

**Feature 014 read-only source**

- `src/infrastructure/statistics/browser.ts:23-43` (`getBrowserStatisticsService`;
  **note** it statically imports `@/infrastructure/analysis/browser`, so it must
  stay behind a dynamic import).
- `src/infrastructure/statistics/statistics-service.ts:76-86`
  (`StatisticsServiceQuery`, `StatisticsResult`), `:197-218` (`gameMetrics`),
  `:361-381` (`trainingSetStats`).
- `src/domain/statistics/types.ts:49-54` (`Aggregate`), `:152-159`
  (`GamesCounts`), `:162-188` (`GameMetrics`), `:305-312` (`GamePartition`).
- `src/domain/statistics/compute.ts:85-99` (`GameMetricsPartition`,
  `GameMetricsComputation`).
- `src/domain/statistics/training.ts:57-74` (`CycleStats`), `:162-179`
  (`TrainingSetStats`).

**Feature 013 canonical training reads**

- `src/domain/training/mastery.ts:111-125` (`masteredPuzzleIds` — allowed).
- `src/domain/training/autoSet.ts:44` (`QUICK_TRAIN_SET_ID`).
- `src/domain/training/cycleTypes.ts:123-169`
  (`TacticalTrainingSetRow`, `TrainingCycleRow`).
- `src/infrastructure/training/training-sets-service.ts:306-308`
  (`getOpenBlock`), `:445-449` (`list`).
- `src/infrastructure/db/training-cycles-repository.ts:83-91` (`listAll`).
- `src/infrastructure/db/puzzles-repository.ts:47` (`listAll`).
- `src/infrastructure/db/attempts-repository.ts:66` (`listAll`).
- `src/infrastructure/db/games-repository.ts:111` (`countGames`).

**Feature 015 honest-state presentation (reuse verbatim)**

- `src/presentation/dashboard/aggregateDisplay.ts:33-43,55-102`
  (`aggregateDisplay`, `insufficientLabel`, `EMPTY_STATE_LABEL`,
  `NOT_DETECTED_STATE_LABEL`).
- `src/presentation/dashboard/formatters.ts:34-36` (`formatCount`), `:48-53`
  (`formatAccuracyDisplay`), `:97-100` (`formatSample`).
- `src/presentation/dashboard/labels.ts:53-58` (`partitionLabel`).
- `src/presentation/dashboard/selection.ts:20-44`
  (`compareByRecency`/`selectDefaultTrainingSet` recency order), `:47-91`
  (`partitionKey`).
- `src/components/dashboard/SummaryCards.tsx:114-146` (AggregateCard pattern),
  `src/components/dashboard/DashboardStates.tsx:11-41`
  (loading/error/retry pattern), `src/components/dashboard/DashboardTrainingSection.tsx:211-243`
  (`CurrentCycleCard` pattern).
- `src/components/puzzles/cycles/labels.ts:15-17` (`cycleStatusLabel`, pure).

**Hook/pattern and window**

- `src/hooks/useDashboard.ts:70-115` (injectable source + slice seams),
  `:187-221` (`initialSlice`/`idleSlice`/`runSlice`), `:223-250` (state),
  `:304-370` (independent game reads), `:374-415` (set listing), `:475-497`
  (return shape).
- `src/domain/gameLibrary/timeframe.ts:11-25,123-124` (`last3m`).
- `src/presentation/dashboard/noDomainMath.test.ts:21-44` (static-guard pattern).

**Fixtures / test utilities**

- `src/test/test-utils.tsx:13-31` (`renderWithProviders`).
- `src/test/fixtures/dashboard/fakeStatistics.ts:57-175` (fake pattern).
- `src/test/fixtures/dashboard/scenarios.ts:83-88,560-611` (scenarios; reuse the
  `gameMetrics` result for the multi-partition/insufficient/notDetected cases).
- `src/domain/training/test-support.ts:252` (`setFixture`), `:284`
  (`cycleFixture`), `:431` (`blockSetFixture`), `:476`
  (`masteryAttemptFixture`).

**Tokens**

- `src/styles/tokens.css:1-105` (light/dark tokens; use `--color-surface`,
  `--color-border`, `--color-fg-muted`, `--space-*`, `--radius-*`,
  `--touch-target-min`).

## 4. Files/modules to create or modify

### New — pure presentation (`src/presentation/home/`)

| File | Contents |
| ---- | -------- |
| `constants.ts` | `HOME_STATS_WINDOW: TimeFrame = { preset: 'last3m' }`, `HOME_STATS_WINDOW_LABEL = 'Last 3 months'` |
| `continue.ts` | `HomeContinueTarget`, `HomeContinueInput`, `resolveHomeContinue(input)` |
| `partition.ts` | `selectPrimaryPartition(partitions)` |
| `primaryAction.ts` | `HomeActionTarget`, `HomePrimaryAction`, `selectHomePrimaryAction(state)` |
| `index.ts` | barrel |
| `continue.test.ts` | selector tests |
| `partition.test.ts` | selector tests |
| `primaryAction.test.ts` | selector tests |
| `noDomainMath.test.ts` | static guard (no statistics math; dynamic data source) |

### New — infrastructure + hook

| File | Contents |
| ---- | -------- |
| `src/infrastructure/home/home-data-source.ts` | `HomeDataSource` interface + `createBrowserHomeDataSource()` (dynamically imports `@/infrastructure/statistics`) |
| `src/infrastructure/home/index.ts` | barrel |
| `src/hooks/useHome.ts` | `HomeSlice`, `HomeGameData`, `HomeTrainingData`, `HomeMasteryData`, `UseHomeOptions`, `UseHome`, `useHome()` |
| `src/hooks/useHome.test.ts` | slice independence / query-shape tests (fake source) |

### New — components (`src/components/home/`)

| File | Contents |
| ---- | -------- |
| `HomeHero.tsx` / `.module.css` | single `<h1>`, tagline, context-aware primary + always-present secondary "Open the Game Library" |
| `HomeContinueCard.tsx` / `.module.css` | named `<section aria-label="Continue training">`, status text, single link |
| `HomeStatsGrid.tsx` / `.module.css` | 4 headline cards + ≤2 secondary cards; first-run replacement |
| `HomeStatCard.tsx` | shared loading/error/value card (uses `aggregateDisplay`/`formatCount`) |
| `HomeEmptyState.tsx` | first-run "No games yet" panel with Game Library link |
| `HomeQuickNav.tsx` / `.module.css` | `<nav aria-label="Quick links">` |
| `HomeHowItWorks.tsx` / `.module.css` | static ordered copy + links; collapsible for returning users |
| `index.ts` | barrel |
| `HomeStatsGrid.test.tsx` | card honest-state tests |
| `HomeContinueCard.test.tsx` | continue card tests |

### Modified / new — page

| File | Change |
| ---- | ------ |
| `src/pages/HomePage.tsx` | rewrite: compose the regions from `useHome` |
| `src/pages/HomePage.module.css` | new page layout (mobile-first single column, responsive card grid) |
| `src/pages/HomePage.test.tsx` | new deterministic page tests |

### New — test fixtures

| File | Contents |
| ---- | -------- |
| `src/test/fixtures/home/fakeHomeDataSource.ts` | call-recording fake implementing `HomeDataSource` |
| `src/test/fixtures/home/scenarios.ts` | deterministic Home scenarios (first-run, no-analysis, partitions, continue states, mastery, block, errors) |

`src/app/router.tsx` is **not** changed: Home stays the statically imported
index route. Only the production data source module is dynamic.

## 5. Domain / data changes

**None.** No new domain rule, no persisted table, no schema change
(`PERSISTENCE_SCHEMA_VERSION` stays `10`; the pre-existing ARCHITECTURE v11
doc/implementation discrepancy is unrelated and out of scope). Home reads only:

| Read | Source |
| ---- | ------ |
| `countGames()` | `gamesRepository` (Feature 007) |
| `gameMetrics({ platform:'all', timeControl:'all', side:'all', result:'all', dateRange: HOME_STATS_WINDOW, now })` | Feature 014 (no `combine`) |
| `list({status:'active'})`, `list({status:'archived'})`, `getOpenBlock()` | `trainingSetsRepository` (Feature 013) |
| `listAll()` cycles | `trainingCyclesRepository` (Feature 013) |
| `trainingSetStats(openBlock.id)` | Feature 014 |
| `listAll()` puzzles, `listAll()` attempts | Feature 011/012 repositories |
| `masteredPuzzleIds(attempts, cycles)` | canonical Feature 013 mastery |

### Selector contracts (pure, no React/Dexie/statistics math)

**`resolveHomeContinue(input)`** — inputs `{ sets, openBlock, cycles }`:

1. `cycle` — the `inProgress` cycle with greatest `startedAt`; tie-break greater
   `cycleNumber`, then `cycleId` ascending. `set` is the owning set row or
   `null`; `quickTrain` is `trainingSetId === QUICK_TRAIN_SET_ID`; label is the
   set name or `"Quick train"`. `abandoned`/`completed` cycles are never chosen.
2. `block` — else the single open Woodpecker block.
3. `set` — else the most recently active custom set (`source.kind !== 'auto'`),
   using the Feature 015 recency order `updatedAt` desc → `createdAt` desc → id
   ascending (`selection.ts:20-44`); active custom sets first, then archived
   custom sets (mirrors `selectDefaultTrainingSet`). The open block is already
   handled in step 2.
4. `none` — otherwise.

**`selectPrimaryPartition(partitions)`** — skip `combined === true` and
`platform === 'fixture'`; return the partition with the greatest
`metrics.games.total`, using strict `>` so ties keep Feature 014's canonical
order (`query.ts:163-199`). Never merges. `null` when none qualifies.

**`selectHomePrimaryAction(state)`** — `state = { totalGames: number | null,
hasEligibleAnalysis: boolean, continueTarget }`:

| Condition | Action |
| --------- | ------ |
| `continueTarget.kind === 'cycle'` | `continue` → `{ to:'cycle', setId, cycleNumber }` |
| `continueTarget.kind === 'block' \| 'set'` | `continue` → `{ to:'set', setId }` |
| `totalGames === null` | `null` (loading/error; component renders a skeleton) |
| `totalGames === 0` | `import` → `{ to:'games' }` |
| `!hasEligibleAnalysis` | `analyze` → `{ to:'games' }` |
| else | `statistics` → `{ to:'statistics' }` |

`hasEligibleAnalysis` is a **presence check** over Feature 014 partitions
(`partitions.some(p => p.metrics.games.analyzed > 0)`) — composition, not math.

### No new math

No sum/average/median/rate/delta/normalization/classification/accuracy/cycle
metric/mastery is computed on Home. The mastered count is the canonical
`masteredPuzzleIds` size; the block progress is `TrainingSetStats.currentCycle`
+ `puzzleCount`; the game cards read Feature 014 aggregates/counts verbatim.

## 6. UI changes

Single responsive column inside the shell:

1. **`HomeHero`** — one `<h1>ChessRemedy</h1>` + one-sentence value statement.
   Primary action is context-aware (`selectHomePrimaryAction`); secondary is
   always a real link **"Open the Game Library"** (`ROUTES.games`). Both are real
   anchors; no hover-only behavior. While the game slice loads the primary is a
   small skeleton (`aria-busy`); on a game-slice error the primary is omitted and
   the secondary stays usable.
2. **`HomeContinueCard`** — rendered only when a target resolves. Named
   `<section aria-label="Continue training">`; label + one line of status
   (`"Cycle N in progress — pick up at the next unanswered puzzle"`, `"Quick
   train"`, `"Open block — start the next cycle"`, or `"Continue this set"`); a
   single `<Link>` to the resolved target. No fabricated progress number.
3. **`HomeStatsGrid`** — first-run: replaced by `HomeEmptyState` ("No games
   yet" + Game Library link). Otherwise a `<dl>` grid (1/2/4 columns) of:
   - **Games analyzed** — `formatCount(analyzed)` of `formatCount(total)` + a
     partition + `HOME_STATS_WINDOW_LABEL` line; no partition → **"No recent
     games"** linking to Statistics; partition but `analyzed === 0` → **"No
     analyses yet"** (never a bare `0`).
   - **Accuracy** — `aggregateDisplay(partition.metrics.accuracy,
     formatAccuracyDisplay)`; shows value + `n`; `insufficient`/`empty` →
     explicit placeholder.
   - **Puzzles mastered** — `formatCount(mastered)` of `formatCount(total)` +
     "puzzles mastered"; no puzzles → **"No puzzles yet"** (never a bare `0`).
   - **Current block** — `TrainingSetStats.currentCycle`: no open block →
     **"No open block"** linking to Training; no cycle → **"Not started"**;
     else `"Cycle N · C of S puzzles done"` + `cycleStatusLabel`, `inProgress`
     labeled partial.
   - Secondary (≤2, only when a primary partition exists): **Blunders per
     game** (`classification.blundersPerGame`) and **Missed tactics per game**
     (`missedTactics.missedTacticsPerGame`, `notDetected` → "Tactics not
     scanned"), both via `aggregateDisplay`.
   - Each card has its own loading/error state with retry; one failed slice never
     blanks another.
   - No chart, sparkline or trend; the window is expressed only by the label.
4. **`HomeQuickNav`** — `<nav aria-label="Quick links">` with real anchors:
   Games (`ROUTES.games`), Training (`ROUTES.training`), Statistics
   (`ROUTES.statistics`), Analysis (`ROUTES.analysisLive`, carries
   `ANALYSIS_GLYPH`). Visible text labels; never icon-only.
5. **`HomeHowItWorks`** — static 4-step copy (Import → Analyze → Train → local
   storage, sync optional) with links to Game Library and Training. Always
   visible for first-run; collapsible (`<details>`/`<summary>`) for returning
   users.

**States**: loading (static regions visible, data regions skeleton with
`aria-busy`), ready, first-run (no games), no-analysis, no-puzzles, no training
target, load error. **A11y**: single `<h1>`; named continue section; stats as a
`<dl>`; quick links as a named `<nav>`; every value/state is text; async
regions use `aria-busy` + a polite live region; `prefers-reduced-motion`
respected; WCAG AA in both themes. **Responsive**: mobile-first single column,
no horizontal scroll, ≥44px touch targets, cards wrap.

## 7. Infrastructure changes

- `src/infrastructure/home/home-data-source.ts` defines the narrow
  `HomeDataSource` seam and `createBrowserHomeDataSource()`. It statically
  imports the repositories (Dexie) and **dynamically** imports
  `@/infrastructure/statistics` so the statistics service, its worker client and
  the engine/analysis module it pulls in never enter the initial Home chunk.
- `src/hooks/useHome.ts` imports `HomeDataSource` **type-only** and dynamic
  `import('@/infrastructure/home/home-data-source')` at runtime when no injected
  source is provided; tests inject a fake and skip the import entirely.
- `useHome` holds four independent slices — `game`, `training`, `mastery`,
  `block` — each `{ data, loading, error }` (the `useDashboard` pattern), with
  `initialSlice`/`idleSlice`/`runSlice` and a `dataVersionKey` memo key
  (`${useId()}:${retryToken}`). `reload()` bumps the retry token and `now`.
- No worker is started; Feature 014's existing worker path is used
  transparently. No cache, no persistence, no sync.

## 8. Staged implementation sequence (narrow gates)

### Stage 0 — Prerequisite check (no code)

Confirm W1 landed: `ROUTES.training`/`ROUTES.statistics`, `trainingSetPath`/
`trainingCyclePath`, `StatisticsPage`, and `selectDefaultPartition` exist.
If not, stop and report the dependency; do not implement against a mixed
vocabulary.

Narrow gate: `npm run typecheck`.

### Stage 1 — Pure selectors + constants + guard

Files: `src/presentation/home/{constants,continue,partition,primaryAction,index}.ts`
and their `.test.ts` + `noDomainMath.test.ts`.

Narrow gate:
`npx vitest run src/presentation/home && npx prettier --check src/presentation/home`.

### Stage 2 — Data source adapter + hook

Files: `src/infrastructure/home/{home-data-source,index}.ts`,
`src/hooks/useHome.ts`, `src/hooks/useHome.test.ts`.

Narrow gate:
`npx vitest run src/hooks/useHome.test.ts src/infrastructure/home`.

### Stage 3 — Components

Files: `src/components/home/*.tsx`, `*.module.css`, `index.ts`, component tests.

Narrow gate: `npx vitest run src/components/home`.

### Stage 4 — Page + fixtures

Files: `src/pages/HomePage.tsx`, `HomePage.module.css`, `HomePage.test.tsx`,
`src/test/fixtures/home/*`.

Narrow gate: `npx vitest run src/pages/HomePage.test.tsx`.

### Stage 5 — Full gate + bundle measurement

Run the full gate (see §13). Then `npm run build` and inspect
`dist/assets/`: the entry/index chunk must not contain a `recharts` module, the
statistics service or the engine; the Home data source must be a separate
chunk. Record the measured chunk names/sizes in the completion report. This is
the spec's "build assertion (or documented measurement)".

## 9. Tests

### Pure selector tests (deterministic, no DOM)

- **`continue.test.ts`** — most recent `inProgress` cycle wins across multiple;
  tie-break by cycle number then id; `abandoned`/`completed` never chosen; open
  block when no cycle; most recent custom set when no block; `none`; Quick-train
  sentinel labeled "Quick train"; a Quick-train cycle with no set row resolves
  without looking up a normal set.
- **`partition.test.ts`** — busiest partition wins; ties keep canonical order;
  `combined` and `fixture` skipped; single partition; none → `null`.
- **`primaryAction.test.ts`** — import / analyze / continue (cycle, block, set)
  / statistics / `null` for unknown counts; continue wins even when counts are
  unknown.

### Hook tests

- `useHome.test.ts` — injected fake records calls; asserts one `gameMetrics`
  call with `dateRange: { preset: 'last3m' }`, `platform/timeControl/side/result:
  'all'`, no `combine`; asserts one `trainingSetStats` call for the open block
  only; asserts a rejected game slice does not blank the training slice and vice
  versa; asserts `masteredPuzzleIds` result is surfaced.

### Component / page tests

- `HomeStatsGrid.test.tsx` — honest states: `ok` value + `n`; `insufficient`
  ("Insufficient data (n = 4)"); `empty` ("No data"); `notDetected` ("Tactics
  not scanned"); "No recent games"; "No analyses yet"; "No puzzles yet";
  "Not started"; partial `inProgress`; `completed`/`abandoned`.
- `HomeContinueCard.test.tsx` — cycle/block/set labels and hrefs; hidden for
  `none`; Quick train.
- `HomePage.test.tsx` — injects the fake `HomeDataSource` and a pinned `now`;
  covers: first-run (no games → "Import your games", no continue card, "No games
  yet", full how-it-works); games no analysis (primary "Analyze a game",
  "No analyses yet"); returning (primary "Continue training"/"View your
  statistics"); quick links resolve to `ROUTES.games`/`training`/`statistics`/
  `analysisLive`; two partitions prove a single labeled partition (never a
  merged series); window label; independent failed game and training slices with
  inline retry; single `<h1>`, named regions, `aria-busy`/live region, text
  state labels.

### Static guards

- `noDomainMath.test.ts` scans `src/presentation/home`, `src/components/home`,
  `src/pages/HomePage.tsx`, `src/hooks/useHome.ts` and asserts:
  - no value import of `@/domain/statistics*`, `@/domain/training/cycleMetrics`,
    `@/domain/analysis/classification`, `@/domain/analysis/summary` (the
    canonical `@/domain/training/mastery` is allowed);
  - no call to `computeStatistics|aggregateOf|setStatsFor|computeGameMetrics|
    computeCycleMetrics|compareCycleMetrics|weakestCategories|
    repeatedlyFailedPuzzles|computePhaseMetrics|resolvePuzzleCycle`;
  - `src/hooks/useHome.ts` uses a dynamic `import('@/infrastructure/home/...')`
    and no static import of `@/infrastructure/statistics`,
    `@/infrastructure/engine` or `recharts`.

### Fixtures

- `fakeHomeDataSource.ts` implements `HomeDataSource`, records every call and
  returns configured Feature-014-shaped results; no IndexedDB/engine/network.
- `scenarios.ts` reuses `setFixture`/`cycleFixture`/`blockSetFixture`/
  `masteryAttemptFixture` (`domain/training/test-support.ts:252,284,431,476`) and
  the Feature-015 `richDashboardScenario().data.gameMetrics` for the
  multi-partition/insufficient/notDetected game cards.

## 10. Migration considerations

- **None.** No Dexie schema bump, no table/column/index, no data backfill, no
  sync change. The existing schema stays at `10`.
- Existing sets/cycles/puzzles/attempts are read-only; Home never mutates.
- The pre-existing ARCHITECTURE v11 vs `PERSISTENCE_SCHEMA_VERSION = 10`
  documentation discrepancy is unrelated and resolved by the v11 workstream,
  not W6.

## 11. Risks & ambiguities

1. **W1 not landed** — the plan uses post-W1 names. Mitigation: Stage 0 gate;
   do not ship a mixed vocabulary.
2. **`hasEligibleAnalysis` over `last3m`** — the primary action uses the same
   bounded window as the cards, so a user whose only analyzed games are older
   than 3 months sees "Analyze a game". This follows the spec's bounded window
   and honest-state rule; the alternative (a second `all` read or a Feature-014
   combined-activity read) is out of scope. Flagged for owner confirmation.
3. **`games.analyzed` is per-partition** — the spec names `games.analyzed` but
   Feature 014 returns it per concrete partition. The plan uses a boolean
   presence check across partitions (composition, not math) to avoid a
   false-negative when the busiest partition is unanalyzed while another is
   analyzed.
4. **`set` fallback scope** — "most recently active custom set" is read as:
   active custom sets by recency, then archived custom sets by recency (mirrors
   `selectDefaultTrainingSet`). If the owner wants archived sets excluded, the
   selector change is one filter.
5. **Mastered count vs deleted puzzles** — `masteredPuzzleIds` may include a
   puzzle whose row was deleted (orphaned attempts are excluded by the function,
   deleted puzzles are not). `M` uses the canonical set size and `P` the
   persisted puzzle count; the edge is rare and not fabricated. Intersecting with
   persisted puzzle ids is a possible follow-up.
6. **Block card coupling** — the block card needs the open block id from the
   training slice; if the training read fails the block card shows the training
   error/retry (per the spec's error case). It never fabricates a cycle.
7. **Code-split proof** — Vitest cannot easily assert the production chunk graph;
   the static guard plus the Stage 5 `dist/assets` measurement is the documented
   evidence. A future build-time budget test can harden this.
8. **`Hero` reuse** — Home uses an equivalent `HomeHero` (the shared `Hero` has
   no action-slot/loading state). This is presentation-only and leaves the
   existing component/tests untouched.
9. **Prettier** — all new/modified files must pass `npm run format:check`; run
   `npx prettier --write` on new files before the full gate.

## 12. Acceptance criteria

Mapped to Feature 018 §"Acceptance criteria" (1–15):

1. `/` renders the five regions inside the shell, replacing the placeholder.
2. The primary action is context-aware and both hero actions are real
   links/buttons.
3. `resolveHomeContinue` is deterministic (cycle → block → set → none) and
   surfaces Quick train.
4. The four headline cards read Feature 014/013 only; the primary partition is
   the busiest concrete partition, never a merge.
5. Every computed aggregate uses `aggregateDisplay`/formatters; absent data is
   never `0`.
6. The `last3m` window is labeled; no partition → "No recent games"; the window
   is never widened.
7. Quick navigation reaches Games, Training, Statistics and Analysis with W1
   labels.
8. First-run, no-analysis and returning states are distinct and correct.
9. No statistics/classification/accuracy/cycle/mastery calculation; the static
   guard enforces it.
10. No engine, no network; reads are local.
11. The initial route bundle excludes Recharts, the statistics service and the
    engine; the data source is a separate chunk.
12. Light/dark legible; desktop/tablet/mobile with touch; nothing hover-only.
13. Single `<h1>`, named regions, accessible continue link, polite async
    announcements.
14. Component tests run against injected fakes with no engine/network/IndexedDB.
15. No new dependency, no ADR, no schema change.

## 13. Verification commands

Narrow-first (per stage), then the full gate:

```bash
# Stage 1
npx vitest run src/presentation/home
npx prettier --check src/presentation/home

# Stage 2
npx vitest run src/hooks/useHome.test.ts src/infrastructure/home

# Stage 3
npx vitest run src/components/home

# Stage 4
npx vitest run src/pages/HomePage.test.tsx

# Full gate (AGENTS.md Execution policy)
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run dev            # smoke: no browser-console errors on /
npm run test:browser   # when Chromium is available
npm audit
```

Bundle measurement after `npm run build`: confirm the entry chunk does not
contain Recharts, the statistics service or the engine, and that the Home data
source is emitted as a separate chunk.
